// 클라이언트와 서버가 함께 쓰는 상수.
// api/*.js 에서도 이 파일을 그대로 import 하므로 브라우저 전용 코드를 넣지 말 것.

export const GRADE = 1;

export const CLASS_MIN = 1;
export const CLASS_MAX = 8; // 1~4반이 기본이지만 5~8반이 합류할 수 있어 여유를 둔다
export const STUDENT_NO_MIN = 1;
export const STUDENT_NO_MAX = 45;
export const NAME_MAX_LEN = 10;

/** 한 판 최대 인정 시간 (이보다 길면 비정상으로 간주) */
export const MAX_SURVIVED_MS = 30 * 60 * 1000;
/** 같은 학생의 저장 요청 최소 간격 */
export const SUBMIT_MIN_INTERVAL_MS = 5000;

/** 라운드 토큰 유효 구간: 실제 경과 시간이 이 범위 안에 있어야 한다 */
export const RUN_ELAPSED_SLACK_MS = 2000; // 네트워크·렌더 지연 여유
export const RUN_ELAPSED_MIN_RATIO = 0.9; // 경과 ≥ 생존시간 × 0.9 - slack
export const RUN_MAX_AGE_MS = 30 * 60 * 1000; // 오프라인 큐 재전송 허용 폭

export const DASHBOARD_POLL_MS = 5000;
export const ALL_BOARD_LIMIT = 30;
export const MY_RECORDS_LIMIT = 20;

/** PRD 4.3 — 기본은 가운데 글자 마스킹, 'full'로 바꾸면 성만 남긴다 */
export const MASK_MODE = 'middle';

/** 확장 대비(4주차 러너 게임과 대시보드 공유) */
export const GAME_ID = 'dodge';

export function studentKey(grade, classNo, studentNo) {
  return `${grade}-${classNo}-${studentNo}`;
}

export function classList() {
  const list = [];
  for (let c = CLASS_MIN; c <= CLASS_MAX; c += 1) list.push(c);
  return list;
}
