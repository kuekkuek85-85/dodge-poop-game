// 기록 저장 경로의 검증 규칙을 확인하는 스모크 테스트.
//   DEV_MEMORY_STORE=1 PORT=3111 node scripts/dev-server.js
//   BASE=http://localhost:3111 node scripts/smoke-test.js

import { scoreAt, levelAt } from '../public/js/shared/difficulty.js';

const BASE = process.env.BASE || 'http://localhost:3111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function get(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, data: await res.json().catch(() => null) };
}

function student(no, name) {
  return { grade: 1, classNo: 3, studentNo: no, name };
}

async function token(profile) {
  const { data } = await post('/api/run/start', profile);
  return data.run;
}

async function main() {
  console.log(`\n대상: ${BASE}\n`);

  // ── 정상 저장 ─────────────────────────────────────
  console.log('정상 저장');
  const alice = student(14, '김하늘');
  const runA = await token(alice);
  await sleep(2200);
  const survivedMs = 2000;
  const okRes = await post('/api/records', {
    ...alice,
    survivedMs,
    score: scoreAt(survivedMs),
    level: levelAt(survivedMs),
    run: runA,
  });
  check('저장 성공', okRes.data?.accepted === true, okRes.data);
  check('첫 기록은 신기록', okRes.data?.isBest === true, okRes.data);
  check('반 순위 1등', okRes.data?.classRank === 1, okRes.data);

  // ── 점수 조작 ─────────────────────────────────────
  console.log('\n점수 조작');
  const bob = student(15, '이바다');
  const runB = await token(bob);
  await sleep(2200);
  const cheatScore = await post('/api/records', {
    ...bob,
    survivedMs: 2000,
    score: 999999,
    level: 1,
    run: runB,
  });
  check('SCORE_MISMATCH로 거부', cheatScore.data?.reason === 'SCORE_MISMATCH', cheatScore.data);

  // ── 생존 시간 조작 ────────────────────────────────
  console.log('\n생존 시간 조작');
  const carol = student(16, '박하람');
  const runC = await token(carol);
  await sleep(500);
  const fakeMs = 10 * 60 * 1000;
  const cheatTime = await post('/api/records', {
    ...carol,
    survivedMs: fakeMs,
    score: scoreAt(fakeMs),
    level: levelAt(fakeMs),
    run: runC,
  });
  check('TOO_FAST로 거부', cheatTime.data?.reason === 'TOO_FAST', cheatTime.data);

  // ── 토큰 없음 / 위조 ──────────────────────────────
  console.log('\n토큰 없음·위조');
  const dave = student(17, '최소연');
  const noToken = await post('/api/records', {
    ...dave,
    survivedMs: 2000,
    score: scoreAt(2000),
    level: 1,
  });
  check('NO_TOKEN으로 거부', noToken.data?.reason === 'NO_TOKEN', noToken.data);

  const eve = student(18, '정다온');
  const runE = await token(eve);
  await sleep(2200);
  const forged = await post('/api/records', {
    ...eve,
    survivedMs: 2000,
    score: scoreAt(2000),
    level: 1,
    run: { ...runE, sig: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  });
  check('BAD_SIGNATURE로 거부', forged.data?.reason === 'BAD_SIGNATURE', forged.data);

  const stolen = await post('/api/records', {
    ...student(19, '한서린'),
    survivedMs: 2000,
    score: scoreAt(2000),
    level: 1,
    run: runA, // 다른 학생에게 발급된 토큰
  });
  check('남의 토큰은 BAD_SIGNATURE', stolen.data?.reason === 'BAD_SIGNATURE', stolen.data);

  // ── 저장 간격 제한 ────────────────────────────────
  console.log('\n저장 간격 제한');
  const frank = student(20, '오시우');
  const runF1 = await token(frank);
  const first = await post('/api/records', {
    ...frank,
    survivedMs: 1500,
    score: scoreAt(1500),
    level: 1,
    run: runF1,
  });
  check('첫 저장 성공', first.data?.accepted === true, first.data);
  const runF2 = await token(frank);
  const tooSoon = await post('/api/records', {
    ...frank,
    survivedMs: 1500,
    score: scoreAt(1500),
    level: 1,
    run: runF2,
  });
  check('429 RATE_LIMITED', tooSoon.status === 429 && tooSoon.data?.code === 'RATE_LIMITED', tooSoon.data);

  // ── 입력값 검증 ───────────────────────────────────
  console.log('\n입력값 검증');
  const badClass = await post('/api/run/start', { grade: 1, classNo: 99, studentNo: 1, name: '가' });
  check('없는 반 거부', badClass.status === 400, badClass.data);
  const badName = await post('/api/run/start', { grade: 1, classNo: 1, studentNo: 1, name: '<script>' });
  check('기호 이름 거부', badName.status === 400, badName.data);

  // ── 조회 ─────────────────────────────────────────
  console.log('\n조회');
  const board = await get('/api/leaderboard?scope=class&classNo=3&me=1-3-14');
  check('반 순위에 2명(정상 기록만)', board.data?.rows?.length === 2, board.data);
  check('이름 가운데 마스킹', board.data?.rows?.[0]?.name === '김○늘', board.data?.rows?.[0]);
  check('본인 행 표시', board.data?.rows?.[0]?.me === true, board.data?.rows?.[0]);

  const revealed = await get('/api/leaderboard?scope=class&classNo=3&reveal=1');
  check('전체 표시 옵션', revealed.data?.rows?.[0]?.name === '김하늘', revealed.data?.rows?.[0]);

  const all = await get('/api/leaderboard?scope=all');
  check('전체 순위 조회', Array.isArray(all.data?.rows), all.data);

  const mine = await get('/api/records?key=1-3-14');
  check('내 기록 조회', mine.data?.records?.length === 1, mine.data);

  // ── 교사 API 보호 ────────────────────────────────
  console.log('\n교사 API 보호');
  const guarded = await get('/api/teacher/board?classNo=3');
  check('비로그인 401', guarded.status === 401, guarded.data);
  const badCode = await post('/api/teacher/login', { code: '000000' });
  check('틀린 코드 401', badCode.status === 401, badCode.data);

  const loginRes = await fetch(`${BASE}/api/teacher/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: process.env.TEACHER_CODE || '123456' }),
  });
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  check('로그인 성공', loginRes.status === 200 && !!cookie);

  const teacherBoard = await fetch(`${BASE}/api/teacher/board?classNo=3`, { headers: { cookie } });
  const teacherData = await teacherBoard.json();
  check('교사 보드는 실명', teacherData.rows?.[0]?.name === '김하늘', teacherData.rows?.[0]);
  check('참여 현황 포함', teacherData.participation?.participants === 2, teacherData.participation);

  const flaggedRes = await fetch(`${BASE}/api/teacher/flagged?classNo=3`, { headers: { cookie } });
  const flaggedData = await flaggedRes.json();
  check('이상 기록 5건 수집', flaggedData.rows?.length === 5, flaggedData.rows?.length);

  const csvRes = await fetch(`${BASE}/api/teacher/export?classNo=3`, { headers: { cookie } });
  const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
  // Response.text()는 BOM을 걷어내므로 바이트로 확인한다
  check('CSV BOM', csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf);
  const csv = new TextDecoder('utf-8').decode(csvBytes);
  check('CSV 헤더', csv.includes('학년'));
  check('CSV에 이상 기록 표시', csv.includes('SCORE_MISMATCH'), csv.slice(0, 200));

  // ── 개별 삭제 후 최고 기록 재계산 ────────────────
  console.log('\n삭제');
  const delRes = await fetch(`${BASE}/api/teacher/record?studentKey=1-3-20`, {
    method: 'DELETE',
    headers: { cookie },
  });
  const delData = await delRes.json();
  check('학생 기록 삭제', delData.ok === true && delData.deleted === 1, delData);
  const afterDelete = await fetch(`${BASE}/api/teacher/board?classNo=3`, { headers: { cookie } });
  const afterDeleteData = await afterDelete.json();
  check('순위에서 사라짐', afterDeleteData.rows?.every((r) => r.studentNo !== 20), afterDeleteData.rows);

  const badConfirm = await fetch(`${BASE}/api/teacher/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ classNo: 3, confirm: '아무거나' }),
  });
  check('확인 문구 틀리면 거부', badConfirm.status === 400);

  const resetRes = await fetch(`${BASE}/api/teacher/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ classNo: 3, confirm: '3반' }),
  });
  const resetData = await resetRes.json();
  check('반 초기화', resetData.ok === true && resetData.deleted >= 1, resetData);

  // 학생 대시보드는 서버 캐시(5초) 때문에 잠깐 이전 값을 보여 준다 — 캐시가 지난 뒤 확인
  await sleep(5200);
  const afterReset = await get('/api/leaderboard?scope=class&classNo=3');
  check('초기화 후 순위 비어 있음', afterReset.data?.rows?.length === 0, afterReset.data);

  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
