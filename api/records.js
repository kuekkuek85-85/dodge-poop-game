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

  const rows = await store.listStudentRecords(key, MY_RECORDS_LIMIT);
  return ok(res, {
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
    flagged,
    flagReason,
    now,
  });

  if (result.rateLimited) {
    return fail(res, 429, 'RATE_LIMITED', '기록 저장이 너무 잦습니다. 잠시 후 자동으로 다시 시도합니다.', {
      retryAfterMs: Math.max(0, Math.ceil(result.retryAfterMs)),
    });
  }

  if (flagged) {
    // 저장은 하되(교사 모드에서 확인·삭제) 순위에는 반영하지 않는다
    return ok(res, { accepted: false, flagged: true, reason: flagReason });
  }

  const board = await store.getClassBoard(identity.value.classNo);
  const better = board.entries.filter(
    (e) => e.key !== identity.value.studentKey && e.score > result.student.bestScore
  ).length;

  return ok(res, {
    accepted: true,
    isBest: result.isBest,
    best: {
      score: result.student.bestScore,
      level: result.student.bestLevel,
      survivedMs: result.student.bestSurvivedMs,
    },
    classRank: better + 1,
    classCount: board.entries.length,
  });
}
