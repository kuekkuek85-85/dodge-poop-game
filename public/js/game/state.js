// 게임 상태와 한 틱(1/60초)의 갱신 규칙.
// 그리기·입력 장치와 분리되어 있어 이 파일만 읽어도 게임 규칙을 알 수 있다.

import * as D from '../shared/difficulty.js';
import { circleHitsRect } from './collision.js';

const PLAYER_MIN_X = D.PLAYER_W / 2;
const PLAYER_MAX_X = D.VIEW_W - D.PLAYER_W / 2;

export function createGame() {
  return {
    elapsedMs: 0, // 생존 시간
    score: 0,
    level: 1,
    spawnTimer: 0,
    poops: [],
    player: { x: D.VIEW_W / 2 },
    over: false,
    levelFlashMs: 0, // 레벨업 강조 연출 남은 시간
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
  game.score = D.scoreAt(game.elapsedMs);

  // 2) 조작대로 움직인다
  movePlayer(game, dtSec, input);

  // 3) 레벨에 맞는 간격으로 똥이 생긴다
  const interval = D.spawnInterval(game.level);
  game.spawnTimer += dtMs;
  while (game.spawnTimer >= interval) {
    game.spawnTimer -= interval;
    spawnPoop(game);
  }

  // 4) 레벨에 맞는 속도로 떨어진다
  const speed = D.fallSpeed(game.level);
  const kept = [];
  for (const poop of game.poops) {
    poop.y += speed * dtSec;
    poop.rot += poop.spin * dtSec;
    if (poop.y - D.POOP_R <= D.VIEW_H) kept.push(poop);
  }
  game.poops = kept;

  // 5) 하나라도 닿으면 끝난다
  const rect = playerRect(game);
  const r = D.POOP_R * D.HITBOX_SHRINK;
  for (const poop of game.poops) {
    if (circleHitsRect(poop.x, poop.y, r, rect.x, rect.y, rect.w, rect.h)) {
      game.over = true;
      break;
    }
  }
}
