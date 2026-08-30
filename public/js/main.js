// 앱 진입점 — 화면 전환, 라운드 토큰 관리, 기록 자동 저장.

import { api, ApiError } from './api.js';
import { studentKey as makeStudentKey } from './shared/config.js';
import * as storage from './storage.js';
import { createDashboardScreen } from './screens/dashboard.js';
import { createEntryScreen } from './screens/entry.js';
import { createGameOverScreen } from './screens/gameover.js';
import { createPlayScreen } from './screens/play.js';

const sections = {
  entry: document.getElementById('screen-entry'),
  play: document.getElementById('screen-play'),
  gameover: document.getElementById('screen-gameover'),
  dashboard: document.getElementById('screen-dashboard'),
};

/** 토큰을 기다리느라 게임 시작이 이보다 오래 밀리지는 않게 한다 */
const TOKEN_WAIT_MS = 3000;

let pendingToken = null; // 다음 판에 쓸 토큰 (미리 받아 둔다)
let tokenFetch = null;
let currentToken = null; // 지금 진행 중인 판의 토큰
let roundSeq = 0;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 라운드 토큰은 반드시 판이 시작되기 "전"에 발급돼 있어야 한다.
 * 그래서 판이 끝날 때가 아니라 미리 받아 두고, 판 시작 시점에 확보한다.
 */
function prefetchToken() {
  if (!app.profile || pendingToken || tokenFetch) return;
  tokenFetch = api
    .startRun(app.profile)
    .then((res) => {
      pendingToken = res.run;
    })
    .catch(() => {
      /* 실패해도 게임은 진행한다 — 다음 기회에 다시 시도 */
    })
    .finally(() => {
      tokenFetch = null;
    });
}

const screens = {};

const app = {
  profile: storage.loadProfile(),
  studentKey: null,

  setProfile(profile) {
    this.profile = profile;
    this.studentKey = makeStudentKey(profile.grade, profile.classNo, profile.studentNo);
    storage.saveProfile(profile);
    pendingToken = null;
    prefetchToken();
  },

  show(name, payload) {
    for (const [key, el] of Object.entries(sections)) {
      const visible = key === name;
      if (!visible && !el.hidden) screens[key]?.onHide?.();
      el.hidden = !visible;
    }
    screens[name]?.onShow?.(payload);
  },

  /**
   * 판을 시작할 때 토큰을 확보한다.
   * 토큰은 반드시 판이 시작되기 전에 발급돼 있어야 하므로, 아직 도착하지 않았다면
   * 잠깐(최대 3초) 기다린다. 그래도 못 받으면 토큰 없이 진행하고 — 늦게 도착한
   * 토큰은 이번 판이 아니라 다음 판용으로 남겨 둔다.
   * @returns {Promise<boolean>} 토큰을 확보했는가
   */
  beginRound() {
    const round = ++roundSeq;
    currentToken = null;

    const take = () => {
      if (!pendingToken) return false;
      currentToken = pendingToken;
      pendingToken = null;
      prefetchToken();
      return true;
    };

    if (take()) return Promise.resolve(true);

    prefetchToken();
    const waiter = tokenFetch || Promise.resolve();
    return Promise.race([waiter, delay(TOKEN_WAIT_MS)]).then(() => {
      if (round !== roundSeq) return false; // 이미 다음 판으로 넘어갔다
      return take();
    });
  },

  finishRound(attempt) {
    this.show('gameover', attempt);
  },

  async saveAttempt(attempt) {
    const key = this.studentKey;
    storage.saveBest(key, attempt.score);
    storage.pushRecent(key, { ...attempt, createdAt: Date.now(), flagged: false });

    const payload = { ...this.profile, ...attempt, run: currentToken };
    currentToken = null;

    const result = await sendRecord(payload);
    if (result.state === 'saved') flushQueue();
    return result;
  },
};

/** 조작으로 판단해 거부한 사유 — 나머지는 연결 문제로 보고 다르게 안내한다 */
const CHEAT_REASONS = new Set(['SCORE_MISMATCH', 'LEVEL_MISMATCH', 'TOO_FAST', 'BAD_SIGNATURE', 'FUTURE_TOKEN']);

async function sendRecord(payload, { allowQueue = true, rateLimitRetries = 1 } = {}) {
  try {
    const res = await api.saveRecord(payload);
    if (res.accepted === false) {
      return { state: CHEAT_REASONS.has(res.reason) ? 'rejected' : 'failed', reason: res.reason };
    }
    return {
      state: 'saved',
      isBest: res.isBest,
      best: res.best,
      classRank: res.classRank,
      classCount: res.classCount,
    };
  } catch (err) {
    const code = err instanceof ApiError ? err.code : null;
    const status = err instanceof ApiError ? err.status : 0;

    if (code === 'RATE_LIMITED') {
      // 짧은 판을 연달아 했을 때 — 남은 시간만큼 기다렸다 다시 보낸다.
      // 재시도 횟수를 제한해 무한히 되돌아오지 않게 한다.
      if (rateLimitRetries <= 0) return { state: 'failed', reason: code };
      const waitMs = Math.min(6000, (err.data?.retryAfterMs || 1000) + 300);
      await delay(waitMs);
      return sendRecord(payload, { allowQueue, rateLimitRetries: rateLimitRetries - 1 });
    }
    if (status >= 400 && status < 500) {
      return { state: 'rejected', reason: code };
    }
    if (allowQueue) {
      const queue = storage.loadQueue();
      queue.push(payload);
      storage.saveQueue(queue);
      return { state: 'queued' };
    }
    return { state: 'failed' };
  }
}

/** 저장하지 못하고 쌓아 둔 기록을 조용히 다시 보낸다 */
async function flushQueue() {
  const queue = storage.loadQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const payload of queue) {
    // 배경 작업이라 기다리지 않는다 — 간격 제한에 걸리면 다음 기회에 다시 보낸다
    const result = await sendRecord(payload, { allowQueue: false, rateLimitRetries: 0 });
    if (result.state === 'failed') remaining.push(payload);
  }
  storage.saveQueue(remaining);
}

function boot() {
  screens.entry = createEntryScreen(app);
  screens.play = createPlayScreen(app);
  screens.gameover = createGameOverScreen(app);
  screens.dashboard = createDashboardScreen(app);

  if (app.profile) {
    app.studentKey = makeStudentKey(app.profile.grade, app.profile.classNo, app.profile.studentNo);
    prefetchToken();
    flushQueue();
  }
  app.show('entry');
}

boot();
