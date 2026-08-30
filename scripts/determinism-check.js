// 프레임률이 달라도 게임 결과가 같은지 확인한다.
// 고정 timestep이 깨지면 저사양 태블릿과 최신 폰의 난이도가 달라진다.
//   node scripts/determinism-check.js

import { createGame, update } from '../public/js/game/state.js';
import { TICK_MS, scoreAt } from '../public/js/shared/difficulty.js';

/** 재현 가능한 난수 (똥 생성 위치를 두 조건에서 동일하게 맞추기 위함) */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** loop.js의 누적기와 같은 방식으로 프레임을 흘려보낸다 */
function simulate(frameMs, totalMs, inputPattern) {
  const originalRandom = Math.random;
  Math.random = seeded(12345);
  try {
    const game = createGame();
    let accumulator = 0;
    let wall = 0;
    let frames = 0;
    while (wall < totalMs && !game.over) {
      wall += frameMs;
      frames += 1;
      accumulator += Math.min(frameMs, 250);
      while (accumulator >= TICK_MS && !game.over) {
        accumulator -= TICK_MS;
        update(game, TICK_MS, inputPattern(game.elapsedMs));
      }
    }
    return {
      elapsedMs: Math.round(game.elapsedMs),
      score: game.score,
      level: game.level,
      over: game.over,
      playerX: Number(game.player.x.toFixed(4)),
      poops: game.poops.length,
      frames,
    };
  } finally {
    Math.random = originalRandom;
  }
}

// 좌우로 왕복하는 고정 조작 패턴 (사람 대신)
const pattern = (elapsed) => ({ dir: Math.floor(elapsed / 700) % 2 === 0 ? -1 : 1, targetX: null });

const at60 = simulate(1000 / 60, 60000, pattern);
const at30 = simulate(1000 / 30, 60000, pattern);
const at144 = simulate(1000 / 144, 60000, pattern);
const jittery = simulate(23.7, 60000, pattern);

let failed = 0;
function same(label, a, b, keys) {
  const diff = keys.filter((k) => a[k] !== b[k]);
  if (diff.length) {
    failed += 1;
    console.log(`  ✗ ${label} — 차이: ${diff.join(', ')}`);
    console.log(`     ${JSON.stringify(a)}`);
    console.log(`     ${JSON.stringify(b)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const keys = ['elapsedMs', 'score', 'level', 'over', 'playerX', 'poops'];
console.log('\n프레임률에 따른 결과 비교 (60초 시뮬레이션)');
console.log(`  60fps: ${JSON.stringify(at60)}`);
same('30fps == 60fps', at30, at60, keys);
same('144fps == 60fps', at144, at60, keys);
same('불규칙 프레임(23.7ms) == 60fps', jittery, at60, keys);

console.log('\n점수 공식이 생존 시간만의 함수인지');
const sample = [0, 1, 999, 1000, 11999, 12000, 12001, 59999, 108000, 300000];
for (const ms of sample) {
  const a = scoreAt(ms);
  const b = scoreAt(ms);
  if (a !== b) {
    failed += 1;
    console.log(`  ✗ scoreAt(${ms}) 불일치`);
  }
}
console.log(`  ✓ scoreAt 재현성 (${sample.length}개 표본)`);
console.log(`  참고: 12초=${scoreAt(12000)}점, 60초=${scoreAt(60000)}점, 120초=${scoreAt(120000)}점`);

console.log(`\n결과: ${failed ? `${failed}개 실패` : '전부 통과'}\n`);
process.exit(failed ? 1 : 0);
