// POST /api/records  — 한 판의 기록을 저장한다 (자동 저장)
// GET  /api/records?key=1-3-14 — 내 회차별 기록

import { allowMethod, fail, getQuery, ok, readBody } from '../lib/http.js';
import { store } from '../lib/store.js';
import { verifyRunToken } from '../lib/token.js';
import { checkConsistency, validateAttempt, validateIdentity } from '../lib/validate.js';
import { MY_RECORDS_LIMIT } from '../public/js/shared/config.js';

const KEY_PATTERN = /^\d{1,2}-\d{1,2}-\d{1,2}$/;

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (!allowMethod(req, res, ['GET', 'POST'])) return;
  return handlePost(req, res);
}

async function handleGet(req, res) {
  const { key } = getQuery(req);
  if (!key || !KEY_PATTERN.test(key)) return fail(res, 400, 'BAD_KEY', '학생 키가 올바르지 않습니다.');

  const [rows, summary] = await Promise.all([
    store.listStudentRecords(key, MY_RECORDS_LIMIT),
    // 목록은 최근 몇 회만 돌려준다. "내 최고 점수"는 전체 기준이어야 하므로
    // 학생 문서에 쌓인 집계를 따로 실어 보낸다.
    store.getStudentSummary(key),
  ]);
  return ok(res, {
    summary: summary || { bestScore: 0, plays: 0 },
    records: rows.map((r) => ({
      id: r.id,
      score: r.score,
      survivedMs: r.survivedMs,
      level: r.level,
      createdAt: r.createdAt,
      flagged: !!r.flagged,
    })),
  });
}

async function handlePost(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(res, 413, 'BODY_TOO_LARGE', '요청이 너무 큽니다.');
  }

  const identity = validateIdentity(body);
  if (!identity.ok) return fail(res, 400, identity.code, identity.message);
  const attempt = validateAttempt(body);
  if (!attempt.ok) return fail(res, 400, attempt.code, attempt.message);

  const now = Date.now();

  // 1) 점수·레벨이 생존 시간에서 나올 수 있는 값인가
  const consistency = checkConsistency(attempt.value);
  // 2) 주장한 생존 시간만큼 실제로 시간이 흘렀는가
  const token = verifyRunToken(body.run, identity.value.studentKey, attempt.value.survivedMs, now);

  const flagged = !consistency.ok || !token.ok;
  const flagReason = !consistency.ok ? consistency.reason : token.ok ? null : token.reason;

  const result = await store.submitAttempt({
    identity: identity.value,
    attempt: attempt.value,
    // 검증을 통과한 토큰만 "사용한 토큰"으로 기록한다.
    // 같은 토큰이 다시 오면 저장하지 않고 성공 응답만 돌려준다 —
    // 응답이 유실돼 재전송된 경우와 의도적인 재사용을 함께 막는다.
    runId: token.ok ? body.run.runId : null,
    // 판이 시작된 시각. 교사가 기록을 지운 시점과 대조해, 초기화 전에 시작한
    // 판이 뒤늦게 도착해 반쪽만 저장되는 일을 막는다.
    runIssuedAt: token.ok ? body.run.issuedAt : null,
    flagged,
    flagReason,
    now,
  });

  if (result.rateLimited) {
    return fail(res, 429, 'RATE_LIMITED', '기록 저장이 너무 잦습니다. 잠시 후 자동으로 다시 시도합니다.', {
      retryAfterMs: Math.max(0, Math.ceil(result.retryAfterMs)),
    });
  }

  if (result.cleared) {
    // 교사가 기록을 초기화한 뒤에 도착한, 초기화 전에 시작한 판
    return ok(res, { accepted: false, reason: 'CLEARED' });
  }

  if (flagged) {
    // 저장은 하되(교사 모드에서 확인·삭제) 순위에는 반영하지 않는다
    return ok(res, { accepted: false, flagged: true, reason: flagReason });
  }

  const board = await store.getClassBoard(identity.value.classNo);
  // 순위표는 동점일 때 먼저 달성한 쪽을 위에 둔다. 결과 화면도 같은 순서를 보여 줘야
  // 하므로, 점수를 다시 세지 말고 순위표에서 내 자리를 그대로 찾는다.
  const myIndex = board.entries.findIndex((e) => e.key === identity.value.studentKey);
  const classRank =
    myIndex >= 0
      ? myIndex + 1
      : board.entries.filter((e) => e.score > result.student.bestScore).length + 1;

  return ok(res, {
    accepted: true,
    isBest: result.isBest,
    duplicate: !!result.duplicate,
    best: {
      score: result.student.bestScore,
      level: result.student.bestLevel,
      survivedMs: result.student.bestSurvivedMs,
    },
    classRank,
    classCount: board.entries.length,
  });
}
