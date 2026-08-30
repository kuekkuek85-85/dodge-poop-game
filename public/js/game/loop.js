// 고정 timestep 게임 루프.
//
// 화면 주사율이 60Hz든 30Hz든 "논리 갱신"은 항상 1/60초 단위로 같은 횟수만큼
// 일어난다. 그래서 저사양 태블릿과 최신 폰의 난이도·점수가 정확히 일치한다.

import { TICK_MS } from '../shared/difficulty.js';

/** 한 프레임에 몰아서 처리할 수 있는 최대 시간 (탭 복귀 시 폭주 방지) */
const MAX_FRAME_MS = 250;

export function createLoop({ update, render }) {
  let rafId = 0;
  let lastTime = 0;
  let accumulator = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    let delta = now - lastTime;
    lastTime = now;
    if (delta > MAX_FRAME_MS) delta = MAX_FRAME_MS;
    accumulator += delta;

    while (accumulator >= TICK_MS) {
      accumulator -= TICK_MS;
      if (update(TICK_MS) === false) {
        // update가 false를 돌려주면 게임 종료 → 남은 누적 시간은 버린다
        accumulator = 0;
        stop();
        render();
        return;
      }
    }
    render();
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    accumulator = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /** 탭 전환 등으로 멈췄다 돌아올 때: 그동안 흐른 시간은 게임에 반영하지 않는다 */
  function resume() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    accumulator = 0;
    rafId = requestAnimationFrame(frame);
  }

  return { start, stop, resume, isRunning: () => running };
}
