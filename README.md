# 똥 피하기 게임 + 기록 대시보드

장평중 1학년 정보 3주차 수업용 웹 게임. 학생은 링크 하나로 들어와 학번·이름만 입력하면
바로 플레이하고, 기록은 자동 저장돼 반별 순위로 즉시 보인다.

- 설계 배경과 결정 근거: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- 요구사항 원본: PRD (2026-08-27)

---

## 빠르게 실행해 보기

Firebase 없이 메모리 저장소로 전체 흐름을 확인할 수 있다.

```bash
npm install
npm run dev            # http://localhost:3000
```

- 학생 화면: <http://localhost:3000>
- 교사 화면: <http://localhost:3000/teacher> (로컬 개발용 기본 코드 `123456`)

테스트:

```bash
npm run test:determinism             # 프레임률이 달라도 결과가 같은지
npm run dev &                        # 다른 터미널에서
BASE=http://localhost:3000 npm run test:smoke   # 저장·검증·교사 API 32개 항목
```

---

## 배포 (Firebase + Vercel)

### 1. Firebase 프로젝트

1. [Firebase 콘솔](https://console.firebase.google.com)에서 **새 프로젝트** 생성
   (2048 게임과 같은 계정, 프로젝트는 별도)
2. **Firestore Database** 만들기 → 위치는 `asia-northeast3 (서울)`
3. 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성** → JSON 파일 저장
4. 보안 규칙에 `firestore.rules` 내용을 붙여넣고 게시
   (이 앱은 브라우저에서 Firestore에 직접 접속하지 않으므로 클라이언트 접근을 전부 막는다)

> 색인(Index)은 따로 만들지 않아도 된다. 모든 쿼리가 단일 필드 조건만 쓰도록 설계했다.

### 2. Vercel

1. 이 저장소를 Vercel에 연결 (프레임워크: **Other**, 빌드 명령 없음)
2. 환경변수 등록 — `.env.example` 참고

   | 이름 | 값 |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | 3번에서 받은 JSON 파일 내용 전체 |
   | `TEACHER_CODE` | 교사 화면 비밀 코드 (**반드시 설정**) |
   | `SESSION_SECRET` | 긴 랜덤 문자열 16자 이상 (권장) |
   | `RUN_SECRET` | 또 다른 긴 랜덤 문자열 (권장) |

   랜덤 문자열은 이렇게 만들면 된다:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. 배포하면 `https://<프로젝트>.vercel.app` 이 학생 접속 주소가 된다

> `TEACHER_CODE`를 설정하지 않으면 교사 API가 오류를 낸다(fail closed). 이 저장소에
> 적힌 값을 그대로 쓰면 저장소를 본 사람이 전체 기록을 내려받거나 지울 수 있으므로,
> **배포에는 여기 적히지 않은 값**을 쓴다. 로컬 개발에서만 기본값 `123456`이 쓰인다.

`SESSION_SECRET` / `RUN_SECRET`을 비워 두면 Firebase 서비스 계정 자격 증명에서
서명 키를 만들어 쓴다. 동작에는 문제가 없지만, **직접 지정하는 쪽을 권한다** —
Firebase 키를 교체하면 교사 로그인이 풀리기 때문이다.

> 서명 키는 커밋 해시나 배포 주소 같은 **공개된 값에서 만들지 않는다**. 그런 값으로
> 만들면 누구나 교사 세션 쿠키를 위조해 전체 기록을 삭제할 수 있다.

---

## 수업에서 쓰는 법

| 대상 | 주소 | 비고 |
|---|---|---|
| 학생 | `https://<프로젝트>.vercel.app` | QR 없이 링크만 배포 |
| 교사 | `.../teacher` | 비밀 코드는 Vercel 환경변수 `TEACHER_CODE` 값 |

교사 화면에서 할 수 있는 것

- 반 선택 → 순위 보드 (5초마다 자동 갱신)
- **투사 모드** 버튼: 관리 버튼을 감추고 글씨를 키운 뒤 전체 화면으로 전환
- **관리** 버튼 안에서
  - 반 인원 수를 입력하면 미참여 번호가 계산된다 (명단을 서버에 두지 않는다)
  - 이상 기록 보기 / 개별 삭제
  - CSV 내려받기 (엑셀에서 한글 정상 표시)
  - 반 기록 초기화 · 전체 기록 삭제 — 확인 문구를 입력해야 실행된다

---

## 난이도 조정

난이도와 점수 공식은 **`public/js/shared/difficulty.js` 한 파일**에 모여 있다.
이 파일은 게임·HUD·서버 검증이 함께 쓰므로, 여기 숫자만 바꾸면 전부 따라 바뀐다.

```js
export const LEVEL_UP_MS     = 14000;  // 몇 초마다 레벨이 오르나
export const FALL_SPEED_BASE = 180;    // 레벨 1 낙하 속도 (px/초)
export const FALL_SPEED_STEP = 36;     // 레벨당 얼마나 빨라지나
export const SPAWN_MS_BASE   = 1050;   // 레벨 1 생성 간격
export const SPAWN_MS_STEP   = 78;     // 레벨당 얼마나 촘촘해지나
export const POINTS_PER_SEC  = 10;     // 1초당 점수
```

바꾼 뒤에는 `npm run test:determinism`으로 프레임률 독립성이 유지되는지 확인한다.

> 현재 값은 자동 플레이 시뮬레이션 기준 한 판 중앙값 28초(최대 126초)다.
> 실제 수치는 태블릿으로 몇 판 해 본 뒤 조정하는 것을 전제로 한다.

---

## 구조

```
public/          정적 파일 (빌드 없음)
  js/shared/     난이도·점수 공식과 공통 상수 — 서버도 이 파일을 import 한다
  js/game/       게임 루프 · 상태 · 입력 · 충돌 · 렌더링
  js/screens/    진입 / 게임 / 결과 / 대시보드
api/             Vercel 서버리스 함수
lib/             Firestore 접근, 검증, 토큰, 세션
scripts/         로컬 개발 서버와 테스트
```

데이터

```
students/{game}:{학년}-{반}-{번호}   학생 1명 = 문서 1개 (최고 기록 1개가 구조로 보장됨)
records/{자동}                      모든 회차 (이상 기록 포함)
boards/{game}_class_{반}            반 순위를 미리 합쳐 둔 문서 — 대시보드는 이것만 읽는다
```

## 기록 신뢰성

점수는 생존 시간만의 함수라서 서버가 정답 점수를 **정확히 다시 계산**할 수 있다.
남는 조작 경로인 "생존 시간 부풀리기"는 게임 시작 시 서버가 발급한 서명 토큰의
경과 시간과 대조해 막는다. 자세한 내용은 구현 계획 문서 1장(D3·D4) 참고.
