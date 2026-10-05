// 자동 시연 화면.
//
// 수업에서 "이런 게임이다"를 보여 주기 위한 페이지다. 사람이 조작하지 않고,
// 게임과 **똑같은 규칙**(state.js)에 자동 조작(autoplay.js)을 붙여 끝없이
// 돌린다. 끊기지 않고 계속 도는 것이 이 화면의 목적이다.
//
// 기록은 저장하지 않는다 — 서버를 전혀 건드리지 않는 순수한 시연이다.

import * as D from './shared/difficulty.js';
import { createGame, update } from './game/state.js';
import { createLoop } from './game/loop.js';
import { createRenderer } from './game/render.js';
import { autoplay } from './game/autoplay.js';

/**
 * 시연에서 난이도가 더는 오르지 않는 레벨.
 *
 * 실제 게임은 14까지 올라가고 화면 위 똥이 16개가 된다. 거기까지 가면
 * 자동 조작도 2~5분이면 죽는다 — 교실 앞에 띄워 두는 화면이 중간에
 * 끊기는 셈이다. 11에서 멈추면(화면 위 7.7개) 7가지 배치 모두 30분을
 * 넘겨도 죽지 않았다.
 *
 * 11은 약 50초 지점이고, 실제 학생 기록의 중앙값(55초)이 닿는 곳이기도
 * 하다. 그래서 학생들이 실제로 겪는 난이도를 보여 주는 셈이 된다.
 */
const DEMO_MAX_LEVEL = 11;

/**
 * 자동 조작 설정.
 * - spacing: 위험이 없을 때 넓은 쪽으로 미리 옮긴다 (가만히 서 있지 않게)
 * - safePath: 가는 길에 쓸려 맞을 자리를 아예 고르지 않는다
 */
const BOT = { spacing: true, safePath: true };

/** 혹시라도 죽었을 때 다음 판까지 (설계상 거의 오지 않는 길이다) */
const RESTART_MS = 1600;

const stage = document.getElementById('stage');
const field = document.getElementById('field');
const canvas = document.getElementById('canvas');
const aim = document.getElementById('aim');
const overBox = document.getElementById('demoOver');
const elOverTime = document.getElementById('demoOverTime');

const el = {
  score: document.getElementById('hudScore'),
  level: document.getElementById('hudLevel'),
  speed: document.getElementById('hudSpeed'),
  spawn: document.getElementById('hudSpawn'),
  life: document.getElementById('hudLife'),
  buff: document.getElementById('hudBuff'),
  levelFlash: document.getElementById('levelFlash'),
  itemFlash: document.getElementById('itemFlash'),
  time: document.getElementById('statTime'),
  statScore: document.getElementById('statScore'),
  statLevel: document.getElementById('statLevel'),
  poops: document.getElementById('statPoops'),
  stageNote: document.getElementById('stageNote'),
};

const ITEM_LABEL = Object.fromEntries(D.ITEM_TYPES.map((t) => [t.id, `${t.icon} ${t.label}!`]));

/** 몇 분씩 돌아가므로 "2050.4초"가 아니라 "34분 10초"로 보여 준다 */
function asTime(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}초`;
  return `${Math.floor(sec / 60)}분 ${String(Math.floor(sec % 60)).padStart(2, '0')}초`;
}

const renderer = createRenderer(canvas);

let game = null;
let loop = null;
let restartTimer = 0;
let aimX = D.VIEW_W / 2;
// 바뀐 값만 DOM에 쓴다 — 매 프레임 전부 쓰면 저사양 노트북에서 눈에 띄게 끊긴다
const shown = { score: -1, level: -1, lives: -1, buff: '', itemFlash: null, tenths: -1, poops: -1 };

function layout() {
  const rect = stage.getBoundingClientRect();
  const pad = 16;
  const scale = Math.min((rect.width - pad) / D.VIEW_W, (rect.height - pad) / D.VIEW_H);
  const w = Math.max(120, Math.floor(D.VIEW_W * scale));
  const h = Math.max(213, Math.floor(D.VIEW_H * scale));
  field.style.width = `${w}px`;
  field.style.height = `${h}px`;
  field.style.setProperty('--scale', String(w / D.VIEW_W));
  renderer.resize();
  if (game) renderer.draw(game);
}

function flashLevel() {
  el.levelFlash.hidden = true;
  void el.levelFlash.offsetWidth; // 애니메이션을 다시 재생시킨다
  el.levelFlash.textContent = `LEVEL ${game.level}`;
  el.levelFlash.hidden = false;
  setTimeout(() => {
    el.levelFlash.hidden = true;
  }, 700);
}

function updateHud() {
  if (game.score !== shown.score) {
    shown.score = game.score;
    el.score.textContent = String(game.score);
    el.statScore.textContent = String(game.score);
  }
  if (game.level !== shown.level) {
    shown.level = game.level;
    el.level.textContent = `LV ${game.level}`;
    el.statLevel.textContent = String(game.level);
    el.speed.textContent = String(Math.round(D.fallSpeed(game.level)));
    el.spawn.textContent = String(Math.round(D.spawnInterval(game.level)));
    if (game.level > 1) flashLevel();
  }
  if (game.lives !== shown.lives) {
    shown.lives = game.lives;
    el.life.textContent = '❤️'.repeat(Math.max(0, game.lives));
  }

  let buff = '';
  if (game.cloakMs > 0) buff = `👻 ${(game.cloakMs / 1000).toFixed(1)}초`;
  else if (game.umbrella > 0) buff = `☂️ ×${game.umbrella}`;
  if (buff !== shown.buff) {
    shown.buff = buff;
    el.buff.textContent = buff;
    el.buff.hidden = buff === '';
  }

  const flashId = game.itemFlash ? game.itemFlash.id : null;
  if (flashId !== shown.itemFlash) {
    shown.itemFlash = flashId;
    if (flashId) {
      el.itemFlash.hidden = true;
      void el.itemFlash.offsetWidth;
      el.itemFlash.textContent = game.itemFlash.bossLeft
        ? '🌀 선풍기! 왕똥은 끄떡없다'
        : ITEM_LABEL[flashId] || '';
      el.itemFlash.hidden = false;
    } else {
      el.itemFlash.hidden = true;
    }
  }

  const tenths = Math.floor(game.elapsedMs / 100);
  if (tenths !== shown.tenths) {
    shown.tenths = tenths;
    el.time.textContent = asTime(game.elapsedMs);
  }
  if (game.poops.length !== shown.poops) {
    shown.poops = game.poops.length;
    el.poops.textContent = `${game.poops.length}개`;
  }

  // 프로그램이 "가려고 정한 자리"를 화면에 세로선으로 표시한다.
  // 이게 보여야 사람이 조작하는 게 아니라는 말이 그냥 설명으로 끝나지 않는다.
  aim.style.left = `${(aimX / D.VIEW_W) * 100}%`;
  aim.hidden = false;
}

function tick(dtMs) {
  const input = autoplay(game, BOT);
  aimX = input.targetX;
  update(game, dtMs, input);
  return !game.over;
}

/**
 * 설계상 거의 오지 않는 길이다 — 레벨 11에서 멈추면 7가지 배치 모두
 * 30분을 넘겨도 죽지 않았다. 그래도 죽었을 때 화면이 멈춰 있지 않도록
 * 다시 시작한다.
 */
function endRun() {
  elOverTime.textContent = asTime(game.elapsedMs);
  overBox.hidden = false;
  aim.hidden = true;
  restartTimer = setTimeout(startRun, RESTART_MS);
}

function startRun() {
  restartTimer = 0;
  game = createGame({ MAX_LEVEL: DEMO_MAX_LEVEL });
  shown.score = -1;
  shown.level = -1;
  shown.lives = -1;
  shown.buff = '';
  shown.itemFlash = null;
  shown.tenths = -1;
  shown.poops = -1;
  el.buff.hidden = true;
  el.itemFlash.hidden = true;
  overBox.hidden = true;
  el.stageNote.textContent = String(D.STAGE_SEED);

  layout();
  updateHud();

  loop = createLoop({
    update: tick,
    render: () => {
      updateHud();
      renderer.draw(game);
      if (game.over && !restartTimer) endRun();
    },
  });
  loop.start();
}

/* 탭이 가려지면 멈춘다 — 돌아왔을 때 그동안 흐른 시간이 몰려 들어오면
   한 프레임에 수십 틱이 처리돼 판이 순식간에 끝난다. */
document.addEventListener('visibilitychange', () => {
  if (!loop) return;
  if (document.hidden) {
    loop.stop();
  } else if (game && !game.over) {
    loop.resume();
  }
});

window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 250));

startRun();
