// 시연 화면(/demo)이 정말 끊기지 않는지 확인한다.
//
// 이 화면의 약속은 하나다 — 교실 앞에 띄워 두면 계속 돈다. 그 약속이
// 깨지는 길은 둘이다: 자동 조작이 약해지거나, 난이도 상한이 올라가거나.
// 둘 다 다른 파일을 고치다 생기므로 여기서 지켜본다.
//
//   node scripts/demo-endless-check.js

import { createGame, update } from '../public/js/game/state.js';
import * as D from '../public/js/shared/difficulty.js';
import { autoplay } from '../public/js/game/autoplay.js';

// public/js/demo.js 와 같은 값이어야 한다
const DEMO_MAX_LEVEL = 11;
const BOT = { spacing: true, safePath: true };

/** 이만큼 버티면 "끊기지 않는다"로 본다 (한 교시보다 길다) */
const SOAK_MS = 50 * 60 * 1000;

/** 실제 스테이지와, 혹시 바꿔 끼울 때를 대비한 다른 배치들 */
const SEEDS = [D.STAGE_SEED, 31415926, 27182818, 16180339, 14142135, 99991, 123457];

function play(seed, cfg, opts) {
  const game = createGame({ ...cfg, STAGE_SEED: seed });
  while (!game.over && game.elapsedMs < SOAK_MS) update(game, D.TICK_MS, autoplay(game, opts));
  return { sec: game.elapsedMs / 1000, alive: !game.over };
}

let failed = 0;
const minutes = (sec) => `${Math.floor(sec / 60)}분 ${String(Math.round(sec % 60)).padStart(2, '0')}초`;

console.log(`\n시연 설정으로 ${SOAK_MS / 60000}분 돌려 본다 (레벨 상한 ${DEMO_MAX_LEVEL})`);
for (const seed of SEEDS) {
  const r = play(seed, { MAX_LEVEL: DEMO_MAX_LEVEL }, BOT);
  if (r.alive) {
    console.log(`  ✓ 씨앗 ${seed} — 끝까지 살아 있음`);
  } else {
    failed += 1;
    console.log(`  ✗ 씨앗 ${seed} — ${minutes(r.sec)} 만에 죽었다`);
  }
}

// 위 검사는 "원래 쉬워서" 통과할 수도 있다. 시연 설정을 빼면 반드시
// 중간에 죽어야, 이 검사가 시연 설정 덕분이라는 말이 성립한다.
console.log('\n시연 설정을 빼면 중간에 죽어야 한다 (검사가 헛돌지 않는지)');
const real = play(D.STAGE_SEED, {}, BOT);
if (real.alive) {
  failed += 1;
  console.log('  ✗ 상한 없이도 끝까지 살아 있다 — 이 검사는 아무것도 재지 않는다');
} else {
  console.log(`  ✓ 레벨 상한을 빼면 ${minutes(real.sec)} 만에 죽는다`);
}
const clumsy = play(D.STAGE_SEED, { MAX_LEVEL: DEMO_MAX_LEVEL }, { spacing: true });
if (clumsy.alive) {
  failed += 1;
  console.log('  ✗ 길 검사(safePath) 없이도 끝까지 살아 있다');
} else {
  console.log(`  ✓ 길 검사를 빼면 ${minutes(clumsy.sec)} 만에 죽는다`);
}

console.log(`\n결과: ${failed ? `${failed}개 실패` : '전부 통과'}\n`);
process.exit(failed ? 1 : 0);
