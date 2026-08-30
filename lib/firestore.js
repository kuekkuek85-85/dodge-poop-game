// Firebase Admin SDK 초기화. 서버리스 인스턴스가 재사용될 때 다시 초기화하지 않도록
// 모듈 전역에 하나만 만들어 둔다.

let dbPromise = null;

function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT 값이 올바른 JSON이 아닙니다.');
    }
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
  }
  return null;
}

export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { cert, getApps, initializeApp } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');

      if (!getApps().length) {
        // Firestore 에뮬레이터에 붙는 경우 자격 증명이 필요 없다.
        // 실제 Firestore에 배포하기 전에 서버 코드 경로를 그대로 검증할 때 쓴다.
        //   firebase emulators:start --only firestore
        //   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=아무거나 npm run dev:firestore
        if (process.env.FIRESTORE_EMULATOR_HOST) {
          initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'dodge-poop-emulator' });
        } else {
          const account = readServiceAccount();
          if (!account) {
            throw new Error(
              'Firebase 자격 증명이 없습니다. FIREBASE_SERVICE_ACCOUNT 환경변수를 설정하거나, ' +
                '로컬 개발이라면 DEV_MEMORY_STORE=1 로 실행하세요.'
            );
          }
          initializeApp({ credential: cert(account), projectId: account.projectId });
        }
      }
      const db = getFirestore();
      db.settings({ ignoreUndefinedProperties: true });
      return db;
    })().catch((err) => {
      dbPromise = null; // 다음 요청에서 다시 시도할 수 있게 한다
      throw err;
    });
  }
  return dbPromise;
}
