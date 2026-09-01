// 프레임률이 달라도 게임 결과가 같은지 확인한다.
// 고정 timestep이 깨지면 저사양 태블릿과 최신 폰의 난이도가 달라진다.
//   node scripts/determinism-check.js

import { createGame, update } from '../public/js/game/state.js';
import { TICK_MS, scoreAt } from '../public/js/shared/difficulty.js';
import { autoplay } from '../public/js/game/autoplay.js';

/**
 * loop.js의 누적기와 같은 방식으로 프레임을 흘려보낸다.
 *
 * **틱 수로 끊는다.** 벽시계로 끊으면 판이 도중에 잘릴 때 프레임 크기마다
 * 끊기는 지점이 몇 ms씩 달라져(60000 vs 60017), 게임은 멀쩡한데 비교가
 * 실패한다. 봇이 제한 시간 전에 죽던 시절에는 이 결함이 드러나지 않았다.
 */
function simulate(frameMs, totalMs, inputPattern) {
  {
    // 배치는 게임 안의 씨앗에서 나온다 — Math.random 을 가로챌 필요가 없다
    const game = createGame();
    const maxTicks = Math.round(totalMs / TICK_MS);
    let accumulator = 0;
    let ticks = 0;
    let frames = 0;
    // 새 요소가 시뮬레이션에서 실제로 등장했는지 (등장하지 않으면 비교가 무의미하다)
    let sawBoss = false;
    let sawItem = false;
    while (ticks < maxTicks && !game.over) {
      frames += 1;
      accumulator += Math.min(frameMs, 250);
      while (accumulator >= TICK_MS && ticks < maxTicks && !game.over) {
        accumulator -= TICK_MS;
        ticks += 1;
        update(game, TICK_MS, inputPattern(game));
        if (game.boss) sawBoss = true;
        if (game.items.length) sawItem = true;
      }
    }
    game.sawBoss = sawBoss;
    game.sawItem = sawItem;
    return {
      elapsedMs: Math.round(game.elapsedMs),
      score: game.score,
      level: game.level,
      over: game.over,
      playerX: Number(game.player.x.toFixed(4)),
      poops: game.poops.length,
      items: game.items.length,
      lives: game.lives,
      umbrella: game.umbrella,
      cloakMs: Math.round(game.cloakMs),
      boss: game.boss ? Math.round(game.boss.y) : null,
      bossLevelDone: game.bossLevelDone,
      sawBoss: game.sawBoss,
      sawItem: game.sawItem,
      frames,
    };
  }
}

// 아무렇게나 왕복하는 패턴으로는 몇 초 만에 죽어서 아이템도 왕똥도 나오기 전에
// 판이 끝난다. 그러면 프레임률 비교가 초반 몇 초만 검사하는 셈이 된다.
const pattern = autoplay;

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

const keys = [
  'elapsedMs',
  'score',
  'level',
  'over',
  'playerX',
  'poops',
  'items',
  'lives',
  'umbrella',
  'cloakMs',
  'boss',
  'bossLevelDone',
];
console.log('\n프레임률에 따른 결과 비교 (60초 시뮬레이션)');
console.log(`  60fps: ${JSON.stringify(at60)}`);
same('30fps == 60fps', at30, at60, keys);
same('144fps == 60fps', at144, at60, keys);
same('불규칙 프레임(23.7ms) == 60fps', jittery, at60, keys);

// 위 비교는 아이템·왕똥이 한 번도 안 나오면 아무것도 검사하지 않은 것과 같다
console.log('\n새 요소가 시뮬레이션에 실제로 등장했는지');
for (const [label, ok] of [
  ['아이템 등장', at60.sawItem],
  ['왕똥 등장', at60.sawBoss],
]) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label} — 등장하지 않아 프레임률 비교가 무의미하다`);
  }
}

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
