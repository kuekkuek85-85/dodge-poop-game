// 앱 진입점 — 화면 전환, 라운드 토큰 관리, 기록 자동 저장.

import { api, ApiError } from './api.js';
import { studentKey as makeStudentKey } from './shared/config.js';
import * as storage from './storage.js';
import { createDashboardScreen } from './screens/dashboard.js';
import { createEntryScreen } from './screens/entry.js';
import { createGameOverScreen } from './screens/gameover.js';
import { createPlayScreen } from './screens/play.js';
import { createRulesModal } from './screens/rules.js';

const sections = {
  entry: document.getElementById('screen-entry'),
  play: document.getElementById('screen-play'),
  gameover: document.getElementById('screen-gameover'),
  dashboard: document.getElementById('screen-dashboard'),
};

/** 토큰을 기다리느라 게임 시작이 이보다 오래 밀리지는 않게 한다 */
const TOKEN_WAIT_MS = 3000;
/**
 * 미리 받아 둔 토큰의 유효 기간.
 * 서버는 토큰이 너무 오래되면 거부한다(RUN_MAX_AGE_MS = 30분). 페이지를 열어 놓고
 * 한참 뒤에 시작하면 정상 기록이 거부될 수 있으므로, 넉넉한 여유를 두고 새로 받는다.
 * 기기 시계가 어긋나도 안전하도록 "받은 시각"을 클라이언트 기준으로 잰다.
 */
const TOKEN_FRESH_MS = 10 * 60 * 1000;

let pendingToken = null; // 다음 판에 쓸 토큰 (미리 받아 둔다)
let pendingTokenAt = 0; // 그 토큰을 받은 시각 (클라이언트 기준)
let tokenFetch = null;
let currentToken = null; // 지금 진행 중인 판의 토큰
let roundSeq = 0;
let profileSeq = 0; // 학생 정보가 바뀔 때마다 올라간다

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 라운드 토큰은 반드시 판이 시작되기 "전"에 발급돼 있어야 한다.
 * 그래서 판이 끝날 때가 아니라 미리 받아 두고, 판 시작 시점에 확보한다.
 */
function prefetchToken() {
  if (!app.profile || pendingToken || tokenFetch) return;
  // 지금 프로필로 요청한다는 표시. 도중에 학생 정보가 바뀌면 이 응답은 버린다.
  const generation = profileSeq;
  tokenFetch = api
    .startRun(app.profile)
    .then((res) => {
      if (generation !== profileSeq) return; // 다른 학생 정보로 바뀌었다
      pendingToken = res.run;
      pendingTokenAt = Date.now();
    })
    .catch(() => {
      /* 실패해도 게임은 진행한다 — 다음 기회에 다시 시도 */
    })
    .finally(() => {
      if (generation === profileSeq) tokenFetch = null;
    });
}

function clearPendingToken() {
  pendingToken = null;
  pendingTokenAt = 0;
}

const screens = {};

const app = {
  profile: storage.loadProfile(),
  studentKey: null,

  setProfile(profile) {
    this.profile = profile;
    this.studentKey = makeStudentKey(profile.grade, profile.classNo, profile.studentNo);
    storage.saveProfile(profile);
    // 이전 학생 이름으로 나간 토큰 요청이 아직 돌아오는 중일 수 있다.
    // 세대를 올려 그 응답을 버리고, 새 요청을 곧바로 시작한다.
    profileSeq += 1;
    clearPendingToken();
    tokenFetch = null;
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
      // 너무 오래 묵은 토큰은 서버가 거부한다 — 버리고 새로 받는다
      if (Date.now() - pendingTokenAt > TOKEN_FRESH_MS) {
        clearPendingToken();
        prefetchToken();
        return false;
      }
      currentToken = pendingToken;
      clearPendingToken();
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
      if (res.reason === 'CLEARED') return { state: 'cleared', reason: res.reason };
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
      enqueue(payload);
      return { state: 'queued' };
    }
    return { state: 'failed' };
  }
}

// ── 저장 대기열 ────────────────────────────────────
//
// 대기열은 항상 저장소를 다시 읽어서 고친다. 대기열을 비우는 동안에도 새 기록이
// 들어올 수 있는데(전송 한 건에 몇 초가 걸린다), 처음에 읽어 둔 목록으로 통째로
// 덮어쓰면 그 사이에 들어온 기록이 조용히 사라진다.

let queueSeq = 0;

/** 대기열 항목을 식별하는 값 — 저장소를 다시 읽어도 같은 항목을 찾을 수 있게 한다 */
function nextQueueId() {
  queueSeq += 1;
  return `q${Date.now()}-${queueSeq}`;
}

function enqueue(payload) {
  const queue = storage.loadQueue();
  queue.push({ ...payload, _qid: nextQueueId() });
  storage.saveQueue(queue);
}

function dequeue(qid) {
  storage.saveQueue(storage.loadQueue().filter((item) => item._qid !== qid));
}

/** 예전 버전에서 남은, 식별자가 없는 항목에 식별자를 붙인다 */
function normalizeQueue() {
  const queue = storage.loadQueue();
  if (queue.every((item) => item && item._qid)) return queue;
  const fixed = queue.map((item) => (item._qid ? item : { ...item, _qid: nextQueueId() }));
  storage.saveQueue(fixed);
  return fixed;
}

let flushing = false;

/**
 * 저장하지 못하고 쌓아 둔 기록을 조용히 다시 보낸다.
 *
 * 방금 저장에 성공한 직후라면 같은 학생의 `lastSubmitAt`이 막 갱신된 참이라
 * 쌓아 둔 기록은 모두 저장 간격 제한에 걸린다. 그래서 간격 제한에 걸리면
 * 서버가 알려 준 시간만큼 기다렸다 다시 보낸다 — 그러지 않으면 대기열이
 * 영영 비워지지 않고, 20개 상한을 넘어가면 오래된 기록부터 사라진다.
 */
async function flushQueue() {
  if (flushing) return;
  const queue = normalizeQueue();
  if (!queue.length) return;

  flushing = true;
  try {
    for (const item of queue) {
      const { _qid, ...payload } = item;
      const result = await sendRecord(payload, { allowQueue: false, rateLimitRetries: 1 });
      // 다시 보내면 될 것만 남긴다. 서버가 사유를 붙여 거절했다면(토큰 만료 등)
      // 몇 번을 더 보내도 결과가 같으므로 대기열에서 뺀다.
      const worthRetrying = result.state === 'failed' && (!result.reason || result.reason === 'RATE_LIMITED');
      if (!worthRetrying) dequeue(_qid);
    }
  } finally {
    flushing = false;
  }
}

function boot() {
  screens.entry = createEntryScreen(app);
  screens.play = createPlayScreen(app);
  screens.gameover = createGameOverScreen(app);
  screens.dashboard = createDashboardScreen(app);
  const rules = createRulesModal();

  if (app.profile) {
    app.studentKey = makeStudentKey(app.profile.grade, app.profile.classNo, app.profile.studentNo);
    prefetchToken();
    flushQueue();
  }
  app.show('entry');
  // 진입 화면을 띄운 뒤에 안내를 올린다 (뒤에 무엇이 있는지 보이게)
  rules.showIfDue();
}

boot();
