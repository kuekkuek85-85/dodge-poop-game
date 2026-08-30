// 사람 대신 플레이하는 규칙 기반 조작.
//
// 난이도를 맞추려면 "괜찮게 하는 사람"이 몇 초나 버티는지 알아야 한다.
// 아무렇게나 왕복하는 패턴으로는 몇 초 만에 죽어서 아이템(6초)이나 왕똥(18초)이
// 나오기도 전에 판이 끝난다. 그래서 앞을 내다보고 피하는 조작을 쓴다.
//
// 규칙은 전부 결정적이다 — 같은 난수 씨앗이면 언제나 같은 판이 나온다.

import * as D from '../shared/difficulty.js';

const PLAYER_TOP = D.VIEW_H - D.PLAYER_BOTTOM - D.PLAYER_H;
/** 조작으로 낼 수 있는 실제 속도 (state.js의 targetX 추종 속도와 같다) */
const MOVE_SPEED = D.PLAYER_SPEED * 1.6;
/** 후보 위치 개수 — 촘촘할수록 잘 피하지만 사람보다 정확해진다 */
const CANDIDATES = 37;

/** 이 x에 서 있으면 부딪히는가 */
function overlaps(x, threatX, threatR) {
  const halfPlayer = (D.PLAYER_W * D.HITBOX_SHRINK) / 2;
  return Math.abs(threatX - x) < threatR * D.HITBOX_SHRINK + halfPlayer;
}

/**
 * @param {object} game
 * @param {object} [opts] { greedy: 아이템을 먹으러 갈지 }
 */
export function autoplay(game, opts = {}) {
  const speed = D.fallSpeed(game.level, game.cfg);
  const threats = [];
  for (const p of game.poops) threats.push({ x: p.x, y: p.y, r: D.POOP_R, v: speed });
  if (game.boss && game.boss.warnMs <= 0) {
    threats.push({ x: game.boss.x, y: game.boss.y, r: D.BOSS_R, v: speed * D.BOSS_SPEED_FACTOR });
  }

  let bestX = game.player.x;
  let bestValue = -Infinity;

  for (let i = 0; i < CANDIDATES; i += 1) {
    const x = (D.VIEW_W / (CANDIDATES - 1)) * i;

    // 이 자리에서 가장 빨리 닥치는 위협까지의 시간 (초)
    let soonest = Infinity;
    for (const t of threats) {
      if (!overlaps(x, t.x, t.r)) continue;
      const dist = PLAYER_TOP - t.y;
      const eta = dist / t.v;
      if (eta >= -0.15 && eta < soonest) soonest = eta;
    }

    // 그 자리까지 가는 데 걸리는 시간. 도착 전에 맞을 자리는 고르지 않는다.
    const travel = Math.abs(x - game.player.x) / MOVE_SPEED;
    if (soonest < travel + 0.05) continue;

    // 3초 앞까지만 본다. 그 뒤는 어차피 새 똥이 생겨 무의미하다.
    let value = Math.min(soonest, 3) * 100 - travel * 12;

    // 안전한 자리들 사이에서는 아이템 쪽을 고른다
    if (opts.greedy !== false) {
      for (const item of game.items) {
        const eta = (PLAYER_TOP - item.y) / D.ITEM_FALL_SPEED;
        if (eta < 0 || eta > 3) continue;
        if (overlaps(x, item.x, D.ITEM_R)) value += 30;
      }
    }

    if (value > bestValue) {
      bestValue = value;
      bestX = x;
    }
  }

  return { dir: 0, targetX: bestX };
}

