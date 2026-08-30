// 서버리스 핸들러 공용 헬퍼. Vercel과 로컬 개발 서버 양쪽에서 동작한다.

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function ok(res, body = {}) {
  sendJson(res, 200, { ok: true, ...body });
}

export function fail(res, status, code, message, extra = {}) {
  sendJson(res, status, { ok: false, code, message, ...extra });
}

export function allowMethod(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  fail(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} 요청은 지원하지 않습니다.`);
  return false;
}

/** Vercel은 JSON 본문을 미리 파싱해 주지만, 로컬 개발 서버는 그렇지 않다 */
export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export function getQuery(req) {
  if (req.query) return req.query;
  const url = new URL(req.url, 'http://localhost');
  return Object.fromEntries(url.searchParams.entries());
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** 아주 단순한 인스턴스 로컬 시도 제한 (비밀 코드 무차별 대입 완화용) */
export function createAttemptLimiter({ max, windowMs }) {
  const hits = new Map();
  return function check(id, now = Date.now()) {
    const list = (hits.get(id) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      hits.set(id, list);
      return { allowed: false, retryAfterMs: windowMs - (now - list[0]) };
    }
    list.push(now);
    hits.set(id, list);
    if (hits.size > 500) {
      // 메모리가 무한정 늘지 않게 오래된 항목 정리
      for (const [key, times] of hits) {
        if (!times.some((t) => now - t < windowMs)) hits.delete(key);
      }
    }
    return { allowed: true };
  };
}
