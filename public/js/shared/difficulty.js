// 난이도 곡선과 점수 공식. 게임·HUD·서버 검증이 모두 이 파일 하나를 쓴다.
// 여기 숫자만 바꾸면 게임 난이도가 통째로 바뀐다. (수업에서 보여줄 파일)

/** 논리 화면 크기 — 실제 캔버스는 이 좌표계를 화면에 맞춰 확대한다 */
export const VIEW_W = 360;
export const VIEW_H = 640;

/** 논리 갱신 주기: 초당 60번 고정 (기기 성능과 무관하게 동일한 난이도) */
export const TICK_MS = 1000 / 60;

export const MAX_LEVEL = 14;
/** 5초마다 레벨 +1 */
export const LEVEL_UP_MS = 5000;

/** 낙하 속도 (px/초) */
export const FALL_SPEED_BASE = 200;
export const FALL_SPEED_STEP = 26;

/**
 * 생성 간격 (ms).
 *
 * 이 게임이 어려워지는 진짜 이유는 속도가 아니라 **개수**다.
 * 속도만 올리면 화면에 떠 있는 똥 수가 그대로여서(낙하 시간이 같이 짧아지므로)
 * 언제나 빠져나갈 틈이 남는다. 그래서 생성 간격을 속도보다 가파르게 좁힌다.
 * 화면 위 똥 개수: 레벨 1에서 약 3.6개 → 레벨 8에서 약 15개.
 */
export const SPAWN_MS_BASE = 880;
export const SPAWN_MS_STEP = 120;
export const SPAWN_MS_MIN = 110;

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

/* ── 목숨 ─────────────────────────────────────────────────────
 * 아이템은 점수를 주지 않는다. 점수가 생존 시간만의 함수여야 서버가
 * 정답 점수를 정확히 다시 계산해 조작을 가려낼 수 있기 때문이다.
 * 아이템은 "더 오래 버티게" 해서 점수에 간접적으로만 영향을 준다.
 * ─────────────────────────────────────────────────────────── */

export const LIVES_START = 2;
export const LIVES_MAX = 3;
/** 맞은 직후 잠깐 무적 — 없으면 똥 하나에 목숨이 두세 개씩 날아간다 */
export const HURT_INVULN_MS = 1200;

/* ── 아이템 ───────────────────────────────────────────────── */

export const ITEM_R = 12;
/** 아이템은 똥보다 느리게 떨어진다 — 먹으러 갈 시간을 준다 */
export const ITEM_FALL_SPEED = 150;
/** 아이템 생성 간격 (ms) */
export const ITEM_SPAWN_MS = 7000;

/** 우산: 똥을 막아 주는 횟수 (시간이 아니라 횟수라서 아껴 쓸 수 있다) */
export const UMBRELLA_BLOCKS = 3;
/** 투명망토: 완전 무적 지속 시간 (왕똥도 통과한다) */
export const CLOAK_MS = 4000;

/**
 * 아이템 종류와 등장 가중치.
 * 우산이 가장 흔하고, 판을 뒤집는 하트가 가장 드물다.
 */
export const ITEM_TYPES = [
  { id: 'umbrella', icon: '☂️', label: '우산', weight: 40 },
  { id: 'fan', icon: '🌀', label: '선풍기', weight: 25 },
  { id: 'cloak', icon: '👻', label: '투명망토', weight: 20 },
  { id: 'heart', icon: '❤️', label: '하트', weight: 15 },
];

const ITEM_WEIGHT_TOTAL = ITEM_TYPES.reduce((sum, t) => sum + t.weight, 0);

/** 0~1 난수 → 아이템 종류 id */
export function pickItemType(random) {
  let n = random * ITEM_WEIGHT_TOTAL;
  for (const type of ITEM_TYPES) {
    n -= type.weight;
    if (n < 0) return type.id;
  }
  return ITEM_TYPES[ITEM_TYPES.length - 1].id;
}

/* ── 왕똥 ─────────────────────────────────────────────────── */

/** 3레벨마다 한 번 (레벨 3·6·9·12 시작 시 = 약 10·25·40·55초) */
export const BOSS_EVERY_LEVELS = 3;
/** 보통 똥의 3배 */
export const BOSS_R = POOP_R * 3;
/** 크고 느리게 — 느려야 "피해야 할 것"으로 읽힌다 */
export const BOSS_SPEED_FACTOR = 0.6;
/** 떨어지기 전 예고 시간. 예고 없이 화면을 덮으면 불공정하게 느껴진다 */
export const BOSS_WARN_MS = 1000;

/** 이 레벨에서 왕똥이 나오나 */
export function bossAtLevel(level) {
  return level % BOSS_EVERY_LEVELS === 0;
}

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
