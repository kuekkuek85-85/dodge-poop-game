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
 * 지금 자리에서 toX 로 가는 **도중에** 이 위협에 쓸려 맞는가.
 *
 * 도착한 자리만 보면 "저기는 안전하다"로 통과해 버린다. 실제로는 가는
 * 길에 있는 똥 밑을 지나면서 맞는다 — 시연 로봇이 아이템을 주우러
 * 화면을 가로지르다 34초쯤 죽던 이유가 이것이었다.
 */
function sweptInto(fromX, toX, t) {
  const reach = t.r * D.HITBOX_SHRINK + (D.PLAYER_W * D.HITBOX_SHRINK) / 2;
  const lo = Math.min(fromX, toX) - reach;
  const hi = Math.max(fromX, toX) + reach;
  if (t.x < lo || t.x > hi) return false; // 아예 지나가지 않는 열

  // 그 열을 지나는 시간대 [들어감, 나옴]
  const d = Math.abs(t.x - fromX);
  const tIn = Math.max(0, (d - reach) / MOVE_SPEED);
  const tOut = (d + reach) / MOVE_SPEED;

  // 그 위협이 플레이어 높이에 걸려 있는 시간대
  const eta = (PLAYER_TOP - t.y) / t.v;
  const dwell = (D.PLAYER_H * D.HITBOX_SHRINK + 2 * t.r * D.HITBOX_SHRINK) / t.v;
  return tIn <= eta + dwell && tOut >= eta;
}

/**
 * @param {object} game
 * @param {object} [opts] { greedy: 아이템을 먹으러 갈지,
 *                          spacing: 안전할 때 미리 넓은 곳으로 옮길지,
 *                          safePath: 가는 길에 쓸려 맞을 자리를 아예 뺄지 }
 */
export function autoplay(game, opts = {}) {
  const speed = D.fallSpeed(game.level, game.cfg);
  const threats = [];
  for (const p of game.poops) threats.push({ x: p.x, y: p.y, r: D.POOP_R, v: speed });
  if (game.boss && game.boss.warnMs <= 0) {
    threats.push({ x: game.boss.x, y: game.boss.y, r: D.BOSS_R, v: speed * D.BOSS_SPEED_FACTOR });
  }

  /** @returns {{x: number, found: boolean}} */
  function choose(safePath) {
    let bestX = game.player.x;
    let bestValue = -Infinity;
    let found = false;

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

      // 가는 길에 쓸려 맞을 자리도 뺀다
      if (safePath && threats.some((t) => sweptInto(game.player.x, x, t))) continue;

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

      // 어디에 서 있어도 안전한 동안에는 위 점수가 전부 같아서, 제자리에
      // 머무르는 쪽이 이긴다(travel = 0). 초반처럼 똥이 드문드문할 때는
      // 주인공이 몇 초씩 가만히 서 있게 된다.
      //
      // spacing을 켜면 그런 때 **가장 넓게 빈 쪽으로 미리 옮긴다** — 규칙
      // 안내에 적어 둔 "코앞에서 피하지 말고 미리 자리를 잡아라"를 그대로
      // 옮긴 것이다. 보너스를 최대 30점으로 묶어 두어, 실제로 더 안전한
      // 자리(0.3초 이상 여유)를 포기하면서까지 옮기지는 않는다.
      if (opts.spacing) {
        let clearance = D.VIEW_W;
        for (const t of threats) {
          if (t.y > PLAYER_TOP) continue; // 이미 지나간 것
          clearance = Math.min(clearance, Math.abs(t.x - x));
        }
        value += Math.min(clearance, 120) * 0.25;
      }

      if (value > bestValue) {
        bestValue = value;
        bestX = x;
        found = true;
      }
    }
    return { x: bestX, found };
  }

  if (opts.safePath) {
    const safe = choose(true);
    // 길이 전부 막혔다면 길 검사를 빼고 다시 고른다 — 그 자리에 굳어
    // 있는 것보다는 덜 나쁜 쪽으로라도 움직이는 편이 낫다.
    if (safe.found) return { dir: 0, targetX: safe.x };
  }
  return { dir: 0, targetX: choose(false).x };
}

