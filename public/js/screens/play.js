// 게임 화면. 루프·입력·렌더러를 붙이고 HUD를 갱신한다.

import * as D from '../shared/difficulty.js';
import { createGame, update } from '../game/state.js';
import { createInput } from '../game/input.js';
import { createLoop } from '../game/loop.js';
import { createRenderer } from '../game/render.js';

const COUNTDOWN_STEPS = ['3', '2', '1', '시작!'];
const COUNTDOWN_STEP_MS = 550;

export function createPlayScreen(app) {
  const stage = document.getElementById('stage');
  const field = document.getElementById('field');
  const canvas = document.getElementById('canvas');
  const elScore = document.getElementById('hudScore');
  const elLevel = document.getElementById('hudLevel');
  const elSpeed = document.getElementById('hudSpeed');
  const elSpawn = document.getElementById('hudSpawn');
  const elFlash = document.getElementById('levelFlash');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const countdownBox = document.getElementById('countdown');
  const btnResume = document.getElementById('btnResume');

  const renderer = createRenderer(canvas);
  const input = createInput(canvas, renderer.toLogical);

  let game = null;
  let loop = null;
  let active = false; // 이 화면이 보이는 중인가
  let countdownTimer = 0;
  const hud = { score: -1, level: -1 };

  function layout() {
    const rect = stage.getBoundingClientRect();
    const pad = 16;
    const scale = Math.min((rect.width - pad) / D.VIEW_W, (rect.height - pad) / D.VIEW_H);
    const w = Math.max(120, Math.floor(D.VIEW_W * scale));
    const h = Math.max(213, Math.floor(D.VIEW_H * scale));
    field.style.width = `${w}px`;
    field.style.height = `${h}px`;
    // HUD·카운트다운 글씨도 게임 화면과 같은 비율로 줄었다 늘었다 해야
    // 가로 모드처럼 화면이 작아졌을 때 서로 겹치지 않는다
    field.style.setProperty('--scale', String(w / D.VIEW_W));
    renderer.resize();
    if (game) renderer.draw(game);
  }

  function updateHud() {
    if (game.score !== hud.score) {
      hud.score = game.score;
      elScore.textContent = String(game.score);
    }
    if (game.level !== hud.level) {
      hud.level = game.level;
      elLevel.textContent = `LV ${game.level}`;
      elSpeed.textContent = String(Math.round(D.fallSpeed(game.level)));
      elSpawn.textContent = String(Math.round(D.spawnInterval(game.level)));
      if (game.level > 1) flashLevel();
    }
  }

  function flashLevel() {
    elFlash.hidden = true;
    // 애니메이션을 다시 재생시키기 위해 리플로우를 한 번 강제한다
    void elFlash.offsetWidth;
    elFlash.textContent = `LEVEL ${game.level}`;
    elFlash.hidden = false;
    setTimeout(() => {
      elFlash.hidden = true;
    }, 700);
  }

  function tick(dtMs) {
    update(game, dtMs, input.read());
    return !game.over;
  }

  function draw() {
    updateHud();
    renderer.draw(game);
  }

  function finish() {
    // 제출값은 반올림한 생존 시간 하나에서 모두 계산한다.
    // 그래야 서버가 같은 함수로 다시 계산했을 때 정확히 일치한다.
    const survivedMs = Math.round(game.elapsedMs);
    app.finishRound({
      survivedMs,
      score: D.scoreAt(survivedMs),
      level: D.levelAt(survivedMs),
    });
  }

  function clearCountdown() {
    if (countdownTimer) clearTimeout(countdownTimer);
    countdownTimer = 0;
    countdownBox.hidden = true;
  }

  function runCountdown(onDone) {
    clearCountdown(); // 이미 도는 카운트다운이 있으면 버린다 (계속하기 연타 방지)
    let index = 0;
    countdownBox.hidden = false;
    const step = () => {
      if (!active) return;
      if (index >= COUNTDOWN_STEPS.length) {
        countdownBox.hidden = true;
        onDone();
        return;
      }
      countdownBox.firstElementChild.textContent = COUNTDOWN_STEPS[index];
      index += 1;
      countdownTimer = setTimeout(step, COUNTDOWN_STEP_MS);
    };
    step();
  }

  function startRound() {
    // 라운드 토큰은 판이 시작되기 전에 확보돼야 한다. 카운트다운이 도는 동안
    // 받아 두고, 카운트다운이 끝나면 그때 루프를 시작한다.
    const tokenReady = app.beginRound();
    game = createGame();
    hud.score = -1;
    hud.level = -1;
    input.reset();
    pauseOverlay.hidden = true;
    layout();
    updateHud();
    renderer.draw(game);

    loop = createLoop({
      update: tick,
      render: () => {
        draw();
        if (game.over) finish();
      },
    });
    runCountdown(() => {
      tokenReady.then(() => {
        if (active && game && !game.over) startLoop();
      });
    });
  }

  /** 카운트다운이 끝났는데 화면이 가려져 있으면(탭 전환 중) 시작하지 않고 멈춰 둔다 */
  function startLoop() {
    if (document.hidden) {
      pauseOverlay.hidden = false;
      return;
    }
    loop.start();
  }

  function pause() {
    if (!loop || !loop.isRunning() || !game || game.over) return;
    loop.stop();
    pauseOverlay.hidden = false;
  }

  function resume() {
    if (!active || !game || game.over) return;
    pauseOverlay.hidden = true;
    input.reset();
    runCountdown(() => {
      if (document.hidden) {
        pauseOverlay.hidden = false;
        return;
      }
      loop.resume();
    });
  }

  btnResume.addEventListener('click', resume);
  window.addEventListener('resize', () => {
    if (active) layout();
  });
  window.addEventListener('orientationchange', () => {
    if (active) setTimeout(layout, 250);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  function onShow() {
    active = true;
    input.attach();
    startRound();
  }

  function onHide() {
    active = false;
    clearCountdown();
    if (loop) loop.stop();
    input.detach();
    input.reset();
    pauseOverlay.hidden = true;
  }

  return { onShow, onHide };
}
