// 난이도 곡선과 점수 공식. 게임·HUD·서버 검증이 모두 이 파일 하나를 쓴다.
// 여기 숫자만 바꾸면 게임 난이도가 통째로 바뀐다. (수업에서 보여줄 파일)

/** 논리 화면 크기 — 실제 캔버스는 이 좌표계를 화면에 맞춰 확대한다 */
export const VIEW_W = 360;
export const VIEW_H = 640;

/** 논리 갱신 주기: 초당 60번 고정 (기기 성능과 무관하게 동일한 난이도) */
export const TICK_MS = 1000 / 60;

/**
 * 스테이지 씨앗 — 똥과 아이템이 떨어지는 순서·위치를 정하는 숫자.
 *
 * 이 값이 고정이라 **모든 학생이 언제나 똑같은 배치**를 만난다. 매판 다르면
 * 같은 실력으로도 기록이 15~65초로 흔들려서, 연습해도 늘었는지 알 수 없다.
 * 배치가 고정이면 여러 번 해 본 학생이 "여기서는 왼쪽" 을 알게 되고,
 * 순위표도 같은 문제를 푼 결과끼리 비교하게 된다.
 *
 * 다음 수업에서 새 판을 주고 싶으면 이 숫자만 바꾸면 된다 (스테이지 2).
 */
export const STAGE_SEED = 20260302;

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
 * 화면 위 똥 개수: 레벨 1의 3.6개에서 레벨 13의 17개까지 **천천히** 오른다.
 *
 * STEP 이 120이던 때는 레벨 7에서 8로 넘어갈 때 11개 → 23개로 두 배가 뛰었다.
 * 실제 학생 기록 1483판을 보니 35초까지는 12%만 죽고, 그 벽을 넘자마자
 * 60%가 레벨 8~11에서 죽었다. "어렵다"는 건 판이 짧다는 뜻이 아니라
 * **갑자기 나타나는 벽** 이야기였다. STEP 을 70으로 낮춰 그 벽을 없앴다 —
 * 학생이 가장 많이 죽던 레벨 11의 밀도가 19개에서 8개로 내려간다.
 *
 * 하한(SPAWN_MS_MIN)이 이 게임의 천장을 정한다. 레벨 8(35초)부터는 생성 간격이
 * 이 값에 걸려 더 좁아지지 않으므로, 그 뒤의 난이도는 오직 이 숫자 하나다.
 *
 *   110  앞을 읽는 플레이어가 아예 죽지 않는다 (기록 = 인내심)
 *    60  잘하는 플레이어가 1분
 *    74  잘하는 플레이어가 약 10분   ← 지금
 *
 * 아이템을 자주 낼수록 게임이 쉬워지므로 이 값도 같이 봐야 한다.
 * 아이템 7초 간격일 때는 76이 10분이었는데, 2.33초로 바꾸니 76은 30분을
 * 넘겨도 안 죽었다. 74로 낮춰 다시 10분에 맞췄다.
 *
 * 초반은 거의 영향을 받지 않는다 — 레벨 7까지는 하한에 걸리지 않는다.
 */
export const SPAWN_MS_BASE = 880;
export const SPAWN_MS_STEP = 70;
export const SPAWN_MS_MIN = 74;

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
/**
 * 아이템 생성 간격 (ms). 45초 한 판에 약 19개가 떨어진다.
 *
 * 드물게 내면 학생이 종류를 익힐 기회가 없다 — 7초 간격일 때는 한 판에
 * 대여섯 개뿐이라 투명망토를 한 번도 못 보고 끝나는 판이 많았다.
 * 자주 내는 만큼 게임이 쉬워지므로 SPAWN_MS_MIN 으로 균형을 맞춘다.
 */
export const ITEM_SPAWN_MS = 2333;

/**
 * 우산: 하나 먹을 때마다 늘어나는 방어 횟수와 그 상한.
 *
 * 먹을 때마다 3으로 되돌리던 때는 이미 우산이 있으면 더 먹어도 소용이 없어,
 * 후반에 우산이 계속 떨어져도 방어가 3에서 멈췄다. 쌓이게 하면 오래 버틴
 * 학생이 그만큼 여유를 갖는다 — 후반이 어렵다는 지적에 대한 답이다.
 *
 * 한 개씩 쌓는 안(BLOCKS=1)은 재 보니 오히려 더 어려웠다. 한 판에 우산을
 * 두세 개밖에 못 먹는 것이 보통이라, 3을 1로 낮추면 대부분의 학생에게는
 * 방어가 3회에서 1회로 줄어드는 것과 같았다 (25개 배치 × 3개 실력에서
 * 평균 생존 36초 → 28초). 한 번에 3개씩 쌓게 두면 예전보다 손해가 없다.
 */
export const UMBRELLA_BLOCKS = 3;
export const UMBRELLA_MAX = 10;
/**
 * 왕똥에 맞으면 우산이 몇 개 부서지나.
 *
 * 우산을 하나씩 쌓게 한 뒤로는 통째로 부수는 규칙이 너무 가혹하다 —
 * 열 개를 모으는 동안 아낀 판을 왕똥 한 번에 잃는다. 왕똥은 크니까
 * 보통 똥보다 비싸게(2개) 두되, 모아 둔 것이 남게 한다.
 */
export const UMBRELLA_BOSS_BREAKS = 2;
/** 투명망토: 완전 무적 지속 시간 (왕똥도 통과한다) */
export const CLOAK_MS = 4000;

/**
 * 아이템 종류와 등장 가중치.
 *
 * 우산만 자주 나오면 나머지를 볼 일이 없다. 선풍기·투명망토를 우산만큼
 * 내보내 종류가 골고루 보이게 한다. 하트는 목숨을 늘려 판을 뒤집으므로
 * 가장 드물게 둔다.
 */
export const ITEM_TYPES = [
  { id: 'umbrella', icon: '☂️', label: '우산', weight: 25 },
  { id: 'fan', icon: '🌀', label: '선풍기', weight: 30 },
  { id: 'cloak', icon: '👻', label: '투명망토', weight: 30 },
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

/* ── 바꿔 볼 수 있는 값들 ─────────────────────────────────────
 * 위 상수를 그대로 모아 둔 것이다. 난이도 실험실(/lab)이 이 묶음만 바꿔
 * 끼워 다른 난이도를 시뮬레이션한다. 아래 함수들은 두 번째 인자를 주지
 * 않으면 언제나 이 기본값을 쓰므로, 게임과 서버의 동작은 달라지지 않는다.
 * ─────────────────────────────────────────────────────────── */
export const DEFAULTS = Object.freeze({
  STAGE_SEED,
  MAX_LEVEL,
  LEVEL_UP_MS,
  FALL_SPEED_BASE,
  FALL_SPEED_STEP,
  SPAWN_MS_BASE,
  SPAWN_MS_STEP,
  SPAWN_MS_MIN,
  POINTS_PER_SEC,
  LEVEL_BONUS,
  LIVES_START,
  LIVES_MAX,
  HURT_INVULN_MS,
  ITEM_SPAWN_MS,
  UMBRELLA_BLOCKS,
  UMBRELLA_MAX,
  UMBRELLA_BOSS_BREAKS,
  CLOAK_MS,
  BOSS_EVERY_LEVELS,
});

/** 빠진 값은 기본값으로 채운다 */
export function withDefaults(overrides) {
  return overrides ? { ...DEFAULTS, ...overrides } : DEFAULTS;
}

/** 이 레벨에서 왕똥이 나오나 */
export function bossAtLevel(level, cfg = DEFAULTS) {
  return level % cfg.BOSS_EVERY_LEVELS === 0;
}

/** 경과 시간(ms) → 레벨 */
export function levelAt(ms, cfg = DEFAULTS) {
  const lv = 1 + Math.floor(ms / cfg.LEVEL_UP_MS);
  return lv > cfg.MAX_LEVEL ? cfg.MAX_LEVEL : lv;
}

/** 레벨 → 낙하 속도 (px/초) */
export function fallSpeed(level, cfg = DEFAULTS) {
  return cfg.FALL_SPEED_BASE + cfg.FALL_SPEED_STEP * (level - 1);
}

/** 레벨 → 생성 간격 (ms) */
export function spawnInterval(level, cfg = DEFAULTS) {
  const ms = cfg.SPAWN_MS_BASE - cfg.SPAWN_MS_STEP * (level - 1);
  return ms < cfg.SPAWN_MS_MIN ? cfg.SPAWN_MS_MIN : ms;
}

/** 레벨 → 점수 배수 */
export function levelMultiplier(level, cfg = DEFAULTS) {
  return 1 + cfg.LEVEL_BONUS * (level - 1);
}

/**
 * 생존 시간(ms) → 점수.
 * 점수는 오직 생존 시간만으로 결정된다. 그래서 서버가 같은 함수로
 * 정답 점수를 다시 계산해 조작 여부를 정확히 가려낼 수 있다.
 */
export function scoreAt(survivedMs, cfg = DEFAULTS) {
  const total = Math.max(0, survivedMs);
  let score = 0;
  let t = 0;
  while (t < total) {
    const level = levelAt(t, cfg);
    const boundary = level >= cfg.MAX_LEVEL ? total : Math.min(total, level * cfg.LEVEL_UP_MS);
    score += ((boundary - t) / 1000) * cfg.POINTS_PER_SEC * levelMultiplier(level, cfg);
    t = boundary;
  }
  return Math.floor(score);
}

/** 화면에 동시에 떠 있는 똥 개수 — 이 게임의 진짜 어려움 */
export function poopsOnScreen(level, cfg = DEFAULTS) {
  return VIEW_H / fallSpeed(level, cfg) / (spawnInterval(level, cfg) / 1000);
}

/** 종료 화면에서 보여줄 레벨별 난이도 표 */
export function difficultyTable(cfg = DEFAULTS) {
  const rows = [];
  for (let level = 1; level <= cfg.MAX_LEVEL; level += 1) {
    rows.push({
      level,
      fromSec: ((level - 1) * cfg.LEVEL_UP_MS) / 1000,
      fallSpeed: fallSpeed(level, cfg),
      spawnMs: spawnInterval(level, cfg),
      multiplier: levelMultiplier(level, cfg),
      onScreen: poopsOnScreen(level, cfg),
    });
  }
  return rows;
}
