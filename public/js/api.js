// 서버 통신. 학교 와이파이가 불안정해도 수업이 멈추지 않도록
// 타임아웃과 재시도를 기본으로 넣는다.

const DEFAULT_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(status, code, message, data) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.data = data || {};
  }
}

async function once(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'same-origin',
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || (data && data.ok === false)) {
      throw new ApiError(res.status, data?.code, data?.message, data);
    }
    return data || {};
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 일시적인 오류(네트워크·5xx)만 재시도한다. 400번대는 다시 보내도 같은 결과다. */
export async function request(path, options = {}, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await once(path, options);
    } catch (err) {
      lastError = err;
      const status = err instanceof ApiError ? err.status : 0;
      const retryable = status === 0 || status >= 500;
      if (!retryable || attempt === retries) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

export const api = {
  startRun: (profile) => request('/api/run/start', { method: 'POST', body: profile }),
  saveRecord: (payload) => request('/api/records', { method: 'POST', body: payload }),
  myRecords: (key) => request(`/api/records?key=${encodeURIComponent(key)}`),
  leaderboard: ({ scope, classNo, me, reveal }) => {
    const params = new URLSearchParams({ scope });
    if (classNo) params.set('classNo', String(classNo));
    if (me) params.set('me', me);
    if (reveal) params.set('reveal', '1');
    return request(`/api/leaderboard?${params.toString()}`);
  },
};
