// POST /api/run/start — 한 판을 시작할 때 라운드 토큰을 발급한다.

import { allowMethod, fail, ok, readBody } from '../../lib/http.js';
import { issueRunToken } from '../../lib/token.js';
import { validateIdentity } from '../../lib/validate.js';

export default async function handler(req, res) {
  if (!allowMethod(req, res, ['POST'])) return;

  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(res, 413, 'BODY_TOO_LARGE', '요청이 너무 큽니다.');
  }

  const identity = validateIdentity(body);
  if (!identity.ok) return fail(res, 400, identity.code, identity.message);

  return ok(res, { run: issueRunToken(identity.value.studentKey) });
}
