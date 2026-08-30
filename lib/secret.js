// 서명용 비밀키.
//
// 교사 세션 쿠키와 라운드 토큰이 이 키로 서명된다. 키를 재현할 수 있는 사람은
// 교사 쿠키를 위조해 전체 기록 삭제까지 할 수 있으므로, **서버에만 있는 값**에서만
// 파생해야 한다. 커밋 해시나 배포 URL 같은 공개 정보는 쓰지 않는다.
//
// 우선순위
//   1. SESSION_SECRET / RUN_SECRET 환경변수 (권장)
//   2. Firebase 서비스 계정 자격 증명에서 파생 — 서버 전용이고 배포 내내 고정
//   3. 로컬 개발용 고정값 (Vercel에서는 여기까지 오면 오류)

import crypto from 'node:crypto';

const MIN_SECRET_LENGTH = 16;

/** 서버 밖으로 나가지 않는 값. 같은 배포의 모든 인스턴스가 같은 값을 얻는다. */
function privateSeed() {
  const candidates = [process.env.FIREBASE_SERVICE_ACCOUNT, process.env.FIREBASE_PRIVATE_KEY];
  for (const value of candidates) {
    if (value && value.length >= 32) return value;
  }
  return null;
}

export function getSecret(name) {
  const fromEnv = process.env[name];
  if (fromEnv) {
    if (fromEnv.length < MIN_SECRET_LENGTH) {
      // 조용히 무시하면 약한 키를 쓰는 줄 모르게 된다 — 분명히 알린다
      throw new Error(`${name} 환경변수가 너무 짧습니다. ${MIN_SECRET_LENGTH}자 이상으로 설정해 주세요.`);
    }
    return fromEnv;
  }

  const seed = privateSeed();
  if (seed) return crypto.createHash('sha256').update(`${name}:${seed}`).digest('hex');

  if (process.env.VERCEL) {
    throw new Error(
      `${name} 환경변수를 설정해 주세요. 공개된 값(커밋 해시·배포 주소)에서 서명 키를 만들면 ` +
        '교사 세션 쿠키를 위조할 수 있습니다.'
    );
  }

  return crypto.createHash('sha256').update(`${name}:local-development-only`).digest('hex');
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
