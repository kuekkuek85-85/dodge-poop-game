// 난이도 점검. 자동 플레이로 여러 판을 돌려 생존 시간 분포를 본다.
//
//   node scripts/tune.js            # 분포 + 레벨별 표
//   RUNS=400 node scripts/tune.js
//
// 목표: 대부분의 판이 20~60초에 끝나야 한 시간 수업에서 태블릿이 돌아간다.
// 자동 플레이는 "꽤 잘하는 학생"에 가깝다. 실제 1학년은 이보다 짧게 나온다.

import { createGame, update } from '../public/js/game/state.js';
import * as D from '../public/js/shared/difficulty.js';
import { autoplay, seeded } from '../public/js/game/autoplay.js';

const RUNS = Number(process.env.RUNS || 200);
const MAX_MS = 5 * 60 * 1000;

function playOnce(seed) {
  const originalRandom = Math.random;
  Math.random = seeded(seed);
  try {
    const game = createGame();
    let sawBoss = false;
    let items = 0;
    let lastLives = game.lives;
    let hits = 0;
    while (!game.over && game.elapsedMs < MAX_MS) {
      update(game, D.TICK_MS, autoplay(game));
      if (game.boss) sawBoss = true;
      if (game.lives < lastLives) hits += 1;
      lastLives = game.lives;
    }
    return { ms: game.elapsedMs, score: game.score, level: game.level, sawBoss, items, hits };
  } finally {
    Math.random = originalRandom;
  }
}

function quantile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

const runs = [];
for (let i = 0; i < RUNS; i += 1) runs.push(playOnce(1000 + i * 7919));

const secs = runs.map((r) => r.ms / 1000).sort((a, b) => a - b);
const scores = runs.map((r) => r.score).sort((a, b) => a - b);
const inTarget = secs.filter((s) => s >= 20 && s <= 60).length;
const tooShort = secs.filter((s) => s < 20).length;
const tooLong = secs.filter((s) => s > 60).length;

console.log(`\n자동 플레이 ${RUNS}판\n`);
console.log('생존 시간 (초)');
for (const q of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
  const label = q === 1 ? '최대' : `${Math.round(q * 100)}%`;
  console.log(`  ${label.padStart(4)}  ${quantile(secs, q).toFixed(1)}`);
}
console.log(`\n점수  중앙 ${quantile(scores, 0.5)}  최대 ${quantile(scores, 1)}`);
console.log(`왕똥을 본 판  ${runs.filter((r) => r.sawBoss).length} / ${RUNS}`);
console.log(`목숨을 잃은 횟수 평균  ${(runs.reduce((s, r) => s + r.hits, 0) / RUNS).toFixed(2)}`);

console.log('\n목표 20~60초 대비');
console.log(`  20초 미만  ${tooShort} (${((tooShort / RUNS) * 100).toFixed(0)}%)`);
console.log(`  20~60초    ${inTarget} (${((inTarget / RUNS) * 100).toFixed(0)}%)`);
console.log(`  60초 초과  ${tooLong} (${((tooLong / RUNS) * 100).toFixed(0)}%)`);

console.log('\n레벨별 난이도');
console.log('  레벨  시작    낙하속도  생성간격  화면위개수  왕똥');
for (let l = 1; l <= D.MAX_LEVEL; l += 1) {
  const v = D.fallSpeed(l);
  const s = D.spawnInterval(l);
  const count = D.VIEW_H / v / (s / 1000);
  console.log(
    `  ${String(l).padStart(4)}  ${String((l - 1) * D.LEVEL_UP_MS / 1000 + '초').padStart(5)}` +
      `  ${String(v + 'px/s').padStart(8)}  ${String(s + 'ms').padStart(8)}` +
      `  ${count.toFixed(1).padStart(10)}  ${D.bossAtLevel(l) ? '○' : ''}`
  );
}
console.log('');
