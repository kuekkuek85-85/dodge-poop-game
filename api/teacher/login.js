// POST   /api/teacher/login  { code } — 비밀 코드 확인 후 세션 쿠키 발급
// GET    /api/teacher/login            — 현재 세션 유효 여부
// DELETE /api/teacher/login            — 로그아웃

import { allowMethod, clientIp, createAttemptLimiter, fail, ok, readBody } from '../../lib/http.js';
import { buildSessionCookie, clearSessionCookie, hasTeacherSession, teacherCode } from '../../lib/session.js';
import { safeEqual } from '../../lib/secret.js';

const limiter = createAttemptLimiter({ max: 10, windowMs: 60 * 1000 });

export default async function handler(req, res) {
  if (req.method === 'GET') return ok(res, { authed: hasTeacherSession(req) });

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return ok(res, { authed: false });
  }

  if (!allowMethod(req, res, ['GET', 'POST', 'DELETE'])) return;

  const gate = limiter(clientIp(req));
  if (!gate.allowed) {
    return fail(res, 429, 'TOO_MANY_ATTEMPTS', '시도가 너무 많습니다. 잠시 후 다시 해 주세요.', {
      retryAfterMs: gate.retryAfterMs,
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(res, 413, 'BODY_TOO_LARGE', '요청이 너무 큽니다.');
  }

  const code = String(body?.code ?? '');
  if (!code || !safeEqual(code, teacherCode())) {
    return fail(res, 401, 'BAD_CODE', '비밀 코드가 올바르지 않습니다.');
  }

  res.setHeader('Set-Cookie', buildSessionCookie());
  return ok(res, { authed: true });
}
