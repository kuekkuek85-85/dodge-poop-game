// 서명용 비밀키.
// 환경변수가 없으면 배포 단위로 고정된 값(커밋 해시 등)에서 파생한다.
// 같은 배포의 모든 서버리스 인스턴스가 같은 값을 얻어야 서명 검증이 통한다.

import crypto from 'node:crypto';

function deploymentSeed() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_URL ||
    'local-development-seed'
  );
}

export function getSecret(name) {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  return crypto.createHash('sha256').update(`${name}:${deploymentSeed()}`).digest('hex');
}

export function hmac(secretName, payload) {
  return crypto.createHmac('sha256', getSecret(secretName)).update(payload).digest('base64url');
}

/** 타이밍 공격을 피하는 문자열 비교 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
