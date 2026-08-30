// 난이도 곡선과 점수 공식. 게임·HUD·서버 검증이 모두 이 파일 하나를 쓴다.
// 여기 숫자만 바꾸면 게임 난이도가 통째로 바뀐다. (수업에서 보여줄 파일)

/** 논리 화면 크기 — 실제 캔버스는 이 좌표계를 화면에 맞춰 확대한다 */
export const VIEW_W = 360;
export const VIEW_H = 640;

/** 논리 갱신 주기: 초당 60번 고정 (기기 성능과 무관하게 동일한 난이도) */
export const TICK_MS = 1000 / 60;

export const MAX_LEVEL = 10;
/** 14초마다 레벨 +1 */
export const LEVEL_UP_MS = 14000;

/** 낙하 속도 (px/초) */
export const FALL_SPEED_BASE = 180;
export const FALL_SPEED_STEP = 36;

/** 생성 간격 (ms) — 초반은 여유 있게, 뒤로 갈수록 빠르게 좁힌다 */
export const SPAWN_MS_BASE = 1050;
export const SPAWN_MS_STEP = 78;
export const SPAWN_MS_MIN = 260;

/** 점수: 1초당 10점 × 레벨 배수 */
export const POINTS_PER_SEC = 10;
export const LEVEL_BONUS = 0.25;

/** 플레이어 */
export const PLAYER_SPEED = 320; // px/초
export const PLAYER_W = 44;
export const PLAYER_H = 52;
export const PLAYER_BOTTOM = 24; // 바닥에서 띄우는 높이

/** 똥 */
export const POOP_R = 13;
/** 충돌 판정은 보이는 크기보다 살짝 작게 (억울한 죽음 방지) */
export const HITBOX_SHRINK = 0.85;

/** 경과 시간(ms) → 레벨 */
export function levelAt(ms) {
  const lv = 1 + Math.floor(ms / LEVEL_UP_MS);
  return lv > MAX_LEVEL ? MAX_LEVEL : lv;
}

/** 레벨 → 낙하 속도 (px/초) */
export function fallSpeed(level) {
  return FALL_SPEED_BASE + FALL_SPEED_STEP * (level - 1);
}

/** 레벨 → 생성 간격 (ms) */
export function spawnInterval(level) {
  const ms = SPAWN_MS_BASE - SPAWN_MS_STEP * (level - 1);
  return ms < SPAWN_MS_MIN ? SPAWN_MS_MIN : ms;
}

/** 레벨 → 점수 배수 */
export function levelMultiplier(level) {
  return 1 + LEVEL_BONUS * (level - 1);
}

/**
 * 생존 시간(ms) → 점수.
 * 점수는 오직 생존 시간만으로 결정된다. 그래서 서버가 같은 함수로
 * 정답 점수를 다시 계산해 조작 여부를 정확히 가려낼 수 있다.
 */
export function scoreAt(survivedMs) {
  const total = Math.max(0, survivedMs);
  let score = 0;
  let t = 0;
  while (t < total) {
    const level = levelAt(t);
    const boundary = level >= MAX_LEVEL ? total : Math.min(total, level * LEVEL_UP_MS);
    score += ((boundary - t) / 1000) * POINTS_PER_SEC * levelMultiplier(level);
    t = boundary;
  }
  return Math.floor(score);
}

/** 종료 화면에서 보여줄 레벨별 난이도 표 */
export function difficultyTable() {
  const rows = [];
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    rows.push({
      level,
      fromSec: ((level - 1) * LEVEL_UP_MS) / 1000,
      fallSpeed: fallSpeed(level),
      spawnMs: spawnInterval(level),
      multiplier: levelMultiplier(level),
    });
  }
  return rows;
}
