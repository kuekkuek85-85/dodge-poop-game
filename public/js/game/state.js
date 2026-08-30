// 게임 상태와 한 틱(1/60초)의 갱신 규칙.
// 그리기·입력 장치와 분리되어 있어 이 파일만 읽어도 게임 규칙을 알 수 있다.

import * as D from '../shared/difficulty.js';
import { circleHitsRect } from './collision.js';

const PLAYER_MIN_X = D.PLAYER_W / 2;
const PLAYER_MAX_X = D.VIEW_W - D.PLAYER_W / 2;

/** 아이템을 먹었을 때 화면에 띄우는 안내가 남아 있는 시간 */
const ITEM_FLASH_MS = 900;

export function createGame() {
  return {
    elapsedMs: 0, // 생존 시간
    score: 0,
    level: 1,
    spawnTimer: 0,
    itemTimer: 0,
    poops: [],
    items: [],
    boss: null, // { x, y, warnMs } — warnMs가 남아 있으면 아직 예고 중
    bossLevelDone: 0, // 왕똥을 이미 내보낸 레벨
    player: { x: D.VIEW_W / 2 },

    // 목숨과 아이템 효과
    lives: D.LIVES_START,
    umbrella: 0, // 우산이 막아 줄 수 있는 남은 횟수
    cloakMs: 0, // 투명망토가 남은 시간
    invulnMs: 0, // 맞은 직후의 짧은 무적

    over: false,
    levelFlashMs: 0, // 레벨업 강조 연출 남은 시간
    itemFlash: null, // { id, ms } — 방금 먹은 아이템 안내
    hurtFlashMs: 0, // 맞은 순간 화면을 붉게
  };
}

function spawnPoop(game) {
  const x = D.POOP_R + Math.random() * (D.VIEW_W - D.POOP_R * 2);
  game.poops.push({
    x,
    y: -D.POOP_R,
    rot: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 2.4,
  });
}

function spawnItem(game) {
  const x = D.ITEM_R + Math.random() * (D.VIEW_W - D.ITEM_R * 2);
  game.items.push({ x, y: -D.ITEM_R, type: D.pickItemType(Math.random()), bob: 0 });
}

function spawnBoss(game) {
  const x = D.BOSS_R + Math.random() * (D.VIEW_W - D.BOSS_R * 2);
  game.boss = { x, y: -D.BOSS_R, warnMs: D.BOSS_WARN_MS };
}

function movePlayer(game, dtSec, input) {
  const p = game.player;
  if (input.targetX !== null) {
    // 드래그/터치한 지점으로 따라간다 (손가락보다 살짝 빠르게)
    const diff = input.targetX - p.x;
    const step = D.PLAYER_SPEED * 1.6 * dtSec;
    p.x += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  } else if (input.dir !== 0) {
    p.x += input.dir * D.PLAYER_SPEED * dtSec;
  }
  if (p.x < PLAYER_MIN_X) p.x = PLAYER_MIN_X;
  if (p.x > PLAYER_MAX_X) p.x = PLAYER_MAX_X;
}

export function playerRect(game) {
  const w = D.PLAYER_W * D.HITBOX_SHRINK;
  const h = D.PLAYER_H * D.HITBOX_SHRINK;
  return {
    x: game.player.x - w / 2,
    y: D.VIEW_H - D.PLAYER_BOTTOM - D.PLAYER_H + (D.PLAYER_H - h),
    w,
    h,
  };
}

/** 지금 어떤 것에도 맞지 않는 상태인가 */
export function isInvincible(game) {
  return game.cloakMs > 0 || game.invulnMs > 0;
}

function applyItem(game, type) {
  switch (type) {
    case 'umbrella':
      game.umbrella = D.UMBRELLA_BLOCKS;
      break;
    case 'cloak':
      game.cloakMs = D.CLOAK_MS;
      break;
    case 'fan':
      // 화면의 똥을 전부 날린다. 왕똥은 무거워서 날아가지 않는다.
      game.poops = [];
      break;
    case 'heart':
      if (game.lives < D.LIVES_MAX) game.lives += 1;
      break;
    default:
      return;
  }
  game.itemFlash = { id: type, ms: ITEM_FLASH_MS };
}

/**
 * 똥에 맞았을 때의 처리.
 * @returns {boolean} 맞은 것을 "소비"했는가 — true면 그 똥은 사라진다
 */
function resolveHit(game, fromBoss) {
  // 무적 중에는 그냥 통과한다 (똥도 사라지지 않는다)
  if (isInvincible(game)) return false;

  if (game.umbrella > 0) {
    // 왕똥은 우산을 통째로 부순다. 투명망토만이 왕똥을 안전하게 넘긴다.
    game.umbrella = fromBoss ? 0 : game.umbrella - 1;
    game.invulnMs = D.HURT_INVULN_MS;
    return true;
  }

  game.lives -= 1;
  game.hurtFlashMs = 400;
  if (game.lives <= 0) {
    game.lives = 0;
    game.over = true;
  } else {
    game.invulnMs = D.HURT_INVULN_MS;
  }
  return true;
}

/**
 * 게임 루프의 본체. dtMs는 항상 고정값(1/60초)으로 들어온다.
 * @param {object} input { dir: -1|0|1, targetX: number|null }
 */
export function update(game, dtMs, input) {
  if (game.over) return;

  const dtSec = dtMs / 1000;

  // 1) 시간이 흐른다 → 레벨과 점수가 결정된다
  game.elapsedMs += dtMs;
  const level = D.levelAt(game.elapsedMs);
  if (level !== game.level) {
    game.level = level;
    game.levelFlashMs = 700;
  }
  if (game.levelFlashMs > 0) game.levelFlashMs -= dtMs;
  if (game.hurtFlashMs > 0) game.hurtFlashMs -= dtMs;
  game.score = D.scoreAt(game.elapsedMs);

  // 2) 아이템 효과의 시간이 줄어든다
  if (game.cloakMs > 0) game.cloakMs = Math.max(0, game.cloakMs - dtMs);
  if (game.invulnMs > 0) game.invulnMs = Math.max(0, game.invulnMs - dtMs);
  if (game.itemFlash) {
    game.itemFlash.ms -= dtMs;
    if (game.itemFlash.ms <= 0) game.itemFlash = null;
  }

  // 3) 조작대로 움직인다
  movePlayer(game, dtSec, input);

  // 4) 레벨에 맞는 간격으로 똥이 생긴다
  const interval = D.spawnInterval(game.level);
  game.spawnTimer += dtMs;
  while (game.spawnTimer >= interval) {
    game.spawnTimer -= interval;
    spawnPoop(game);
  }

  // 5) 아이템이 생긴다
  game.itemTimer += dtMs;
  while (game.itemTimer >= D.ITEM_SPAWN_MS) {
    game.itemTimer -= D.ITEM_SPAWN_MS;
    spawnItem(game);
  }

  // 6) 3레벨마다 왕똥이 한 번 내려온다
  if (!game.boss && D.bossAtLevel(game.level) && game.bossLevelDone !== game.level) {
    game.bossLevelDone = game.level;
    spawnBoss(game);
  }

  // 7) 레벨에 맞는 속도로 떨어진다
  const speed = D.fallSpeed(game.level);
  const kept = [];
  for (const poop of game.poops) {
    poop.y += speed * dtSec;
    poop.rot += poop.spin * dtSec;
    if (poop.y - D.POOP_R <= D.VIEW_H) kept.push(poop);
  }
  game.poops = kept;

  const keptItems = [];
  for (const item of game.items) {
    item.y += D.ITEM_FALL_SPEED * dtSec;
    item.bob += dtSec * 6;
    if (item.y - D.ITEM_R <= D.VIEW_H) keptItems.push(item);
  }
  game.items = keptItems;

  if (game.boss) {
    if (game.boss.warnMs > 0) {
      game.boss.warnMs -= dtMs; // 예고 중에는 아직 떨어지지 않는다
    } else {
      game.boss.y += speed * D.BOSS_SPEED_FACTOR * dtSec;
      if (game.boss.y - D.BOSS_R > D.VIEW_H) game.boss = null;
    }
  }

  // 8) 아이템을 먹는다
  const rect = playerRect(game);
  const remainingItems = [];
  for (const item of game.items) {
    if (circleHitsRect(item.x, item.y, D.ITEM_R, rect.x, rect.y, rect.w, rect.h)) {
      applyItem(game, item.type);
    } else {
      remainingItems.push(item);
    }
  }
  game.items = remainingItems;

  // 9) 맞으면 목숨이 줄고, 다 떨어지면 끝난다
  const r = D.POOP_R * D.HITBOX_SHRINK;
  const survivors = [];
  for (const poop of game.poops) {
    if (!game.over && circleHitsRect(poop.x, poop.y, r, rect.x, rect.y, rect.w, rect.h)) {
      if (resolveHit(game, false)) continue; // 막았거나 목숨을 잃었다 → 이 똥은 사라진다
    }
    survivors.push(poop);
  }
  game.poops = survivors;

  if (game.boss && game.boss.warnMs <= 0 && !game.over) {
    const br = D.BOSS_R * D.HITBOX_SHRINK;
    if (circleHitsRect(game.boss.x, game.boss.y, br, rect.x, rect.y, rect.w, rect.h)) {
      if (resolveHit(game, true)) game.boss = null;
    }
  }
}
