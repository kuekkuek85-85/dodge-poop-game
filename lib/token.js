// 라운드 토큰.
//
// 점수는 생존 시간만으로 결정되므로(shared/difficulty.js), 남은 조작 경로는
// "생존 시간 부풀리기" 하나뿐이다. 게임 시작 시각을 서버가 서명해 두고
// 저장할 때 실제 경과 시간과 대조하면 그 경로가 막힌다.
//
// 별도 저장소가 필요 없는 무상태 방식이다. 오래된 토큰을 다시 써도
// 경과 시간 상한에 걸리고, 설령 통과해도 같은 점수라 이득이 없다.

import crypto from 'node:crypto';
import { hmac, safeEqual } from './secret.js';
import {
  RUN_ELAPSED_MIN_RATIO,
  RUN_ELAPSED_SLACK_MS,
  RUN_MAX_AGE_MS,
} from '../public/js/shared/config.js';

function payloadOf(runId, issuedAt, studentKey) {
  return `${runId}.${issuedAt}.${studentKey}`;
}

export function issueRunToken(studentKey) {
  const runId = crypto.randomUUID();
  const issuedAt = Date.now();
  return { runId, issuedAt, sig: hmac('RUN_SECRET', payloadOf(runId, issuedAt, studentKey)) };
}

/**
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verifyRunToken(run, studentKey, survivedMs, now = Date.now()) {
  if (!run || typeof run !== 'object') return { ok: false, reason: 'NO_TOKEN' };
  const { runId, issuedAt, sig } = run;
  if (typeof runId !== 'string' || typeof sig !== 'string' || !Number.isFinite(issuedAt)) {
    return { ok: false, reason: 'BAD_TOKEN' };
  }
  const expected = hmac('RUN_SECRET', payloadOf(runId, issuedAt, studentKey));
  if (!safeEqual(sig, expected)) return { ok: false, reason: 'BAD_SIGNATURE' };

  const elapsed = now - issuedAt;
  if (elapsed < 0) return { ok: false, reason: 'FUTURE_TOKEN' };
  if (elapsed < survivedMs * RUN_ELAPSED_MIN_RATIO - RUN_ELAPSED_SLACK_MS) {
    // 주장한 생존 시간만큼 실제로 시간이 흐르지 않았다
    return { ok: false, reason: 'TOO_FAST' };
  }
  if (elapsed > survivedMs + RUN_MAX_AGE_MS) return { ok: false, reason: 'STALE_TOKEN' };
  return { ok: true };
}
