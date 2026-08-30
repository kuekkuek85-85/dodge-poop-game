// 한 반 규모 동시 접속 부하 점검.
//
// 순위표는 반마다 문서 하나를 함께 고쳐 쓴다. 28명이 몰릴 때 그 문서에 쓰기가
// 겹쳐도 기록이 유실되지 않는지, 결과가 순위표와 어긋나지 않는지 확인한다.
//
//   BASE=http://localhost:3000 node scripts/load-test.js
//   BASE=... STUDENTS=28 ROUNDS=3 node scripts/load-test.js

import { scoreAt, levelAt } from '../public/js/shared/difficulty.js';
import { SUBMIT_MIN_INTERVAL_MS } from '../public/js/shared/config.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const CLASS_NO = Number(process.env.CLASS_NO || 7);
const STUDENTS = Number(process.env.STUDENTS || 28);
const ROUNDS = Number(process.env.ROUNDS || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** 한 학생이 여러 판을 이어서 하는 흐름 */
async function playStudent(studentNo, result) {
  const profile = { grade: 1, classNo: CLASS_NO, studentNo, name: `학생${studentNo}` };
  let best = 0;

  for (let round = 0; round < ROUNDS; round += 1) {
    const start = await post('/api/run/start', profile);
    if (!start.data?.run) {
      result.tokenFailures += 1;
      continue;
    }

    // 학생마다 다른 길이로 논다 (1.5~9초)
    const survivedMs = 1500 + ((studentNo * 7 + round * 13) % 76) * 100;
    await sleep(Math.max(0, survivedMs * 0.9 - 2000) + 200);

    const res = await post('/api/records', {
      ...profile,
      survivedMs,
      score: scoreAt(survivedMs),
      level: levelAt(survivedMs),
      run: start.data.run,
    });

    if (res.status === 429) result.rateLimited += 1;
    else if (res.data?.accepted === true) {
      result.accepted += 1;
      best = Math.max(best, scoreAt(survivedMs));
    } else if (res.status >= 500) result.serverErrors += 1;
    else result.rejected.push(res.data?.reason || res.data?.code || res.status);

    // 다음 판 사이의 간격 (저장 간격 제한을 넘긴다)
    await sleep(SUBMIT_MIN_INTERVAL_MS + 300);
  }

  result.expectedBest.set(studentNo, best);
}

async function main() {
  console.log(`\n대상 ${BASE} · ${CLASS_NO}반 · 학생 ${STUDENTS}명 × ${ROUNDS}판\n`);

  const result = {
    accepted: 0,
    rateLimited: 0,
    serverErrors: 0,
    tokenFailures: 0,
    rejected: [],
    expectedBest: new Map(),
  };

  // 반 번호가 범위를 벗어나면 토큰 발급부터 실패한다 — 먼저 알려 준다
  const probe = await post('/api/run/start', { grade: 1, classNo: CLASS_NO, studentNo: 1, name: '점검' });
  if (!probe.data?.run) {
    console.log(`시작할 수 없습니다: ${JSON.stringify(probe.data)}`);
    process.exit(1);
  }

  const started = Date.now();
  await Promise.all(
    Array.from({ length: STUDENTS }, (_, i) => playStudent(i + 1, result))
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`걸린 시간      ${elapsed}초`);
  console.log(`저장 성공      ${result.accepted} / ${STUDENTS * ROUNDS}`);
  console.log(`간격 제한      ${result.rateLimited}`);
  console.log(`토큰 발급 실패 ${result.tokenFailures}`);
  console.log(`서버 오류      ${result.serverErrors}`);
  if (result.rejected.length) console.log(`거절 사유      ${JSON.stringify(result.rejected)}`);

  // 순위표가 실제 최고 기록과 일치하는지 — 문서 쓰기가 겹쳐도 유실이 없어야 한다
  await sleep(5500); // 순위 캐시 통과
  const board = await (await fetch(`${BASE}/api/leaderboard?scope=class&classNo=${CLASS_NO}&reveal=1`)).json();
  const onBoard = new Map(board.rows.map((r) => [r.name, r.score]));

  let missing = 0;
  let mismatched = 0;
  for (const [studentNo, best] of result.expectedBest) {
    if (best <= 0) continue;
    const shown = onBoard.get(`학생${studentNo}`);
    if (shown === undefined) missing += 1;
    else if (shown !== best) mismatched += 1;
  }

  console.log(`\n순위표 인원    ${board.rows.length}`);
  console.log(`순위표 누락    ${missing}`);
  console.log(`점수 불일치    ${mismatched}`);

  const ok = result.serverErrors === 0 && result.tokenFailures === 0 && missing === 0 && mismatched === 0;
  console.log(`\n결과: ${ok ? '이상 없음' : '문제 있음'}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
