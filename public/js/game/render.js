// Canvas 2D 렌더링. 캐릭터와 똥은 시작할 때 한 번만 그려 두고(스프라이트)
// 매 프레임에는 그 이미지를 옮겨 붙이기만 한다 → 저사양 태블릿에서도 가볍다.

import * as D from '../shared/difficulty.js';
import { playerRect } from './state.js';

const MAX_DPR = 2; // 3배 이상은 화질 차이 대비 비용이 크다

function makeSprite(w, h, dpr, paint) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  paint(g);
  return c;
}

/** roundRect는 구형 Safari에 없다 — 없으면 각진 사각형으로 대체한다 */
function fillRoundRect(g, x, y, w, h, r) {
  if (typeof g.roundRect === 'function') {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  } else {
    g.fillRect(x, y, w, h);
  }
}

function paintPoop(g, r, angry) {
  const cx = r;
  const cy = r;
  g.fillStyle = '#7b4a1e';
  g.beginPath();
  g.ellipse(cx, cy + r * 0.55, r * 0.98, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#8d5726';
  g.beginPath();
  g.ellipse(cx, cy + r * 0.05, r * 0.75, r * 0.4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#a2662f';
  g.beginPath();
  g.ellipse(cx, cy - r * 0.45, r * 0.5, r * 0.36, 0, 0, Math.PI * 2);
  g.fill();
  // 눈
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx - r * 0.26, cy + r * 0.1, r * 0.2, 0, Math.PI * 2);
  g.arc(cx + r * 0.26, cy + r * 0.1, r * 0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1c1917';
  g.beginPath();
  g.arc(cx - r * 0.26, cy + r * 0.12, r * 0.09, 0, Math.PI * 2);
  g.arc(cx + r * 0.26, cy + r * 0.12, r * 0.09, 0, Math.PI * 2);
  g.fill();

  // 왕똥은 화난 눈썹으로 보통 똥과 구별한다
  if (angry) {
    g.strokeStyle = '#1c1917';
    g.lineWidth = r * 0.09;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - r * 0.46, cy - r * 0.16);
    g.lineTo(cx - r * 0.08, cy + r * 0.02);
    g.moveTo(cx + r * 0.46, cy - r * 0.16);
    g.lineTo(cx + r * 0.08, cy + r * 0.02);
    g.stroke();
  }
}

/* ── 아이템 ───────────────────────────────────────────────────
 * 색이 다른 동그라미 위에 흰 기호를 얹는다. 작게 그려도 색만으로
 * 구분되므로, 태블릿에서 빠르게 지나가도 무엇인지 알 수 있다.
 * ─────────────────────────────────────────────────────────── */

const ITEM_COLORS = {
  umbrella: '#ef4444',
  fan: '#0ea5e9',
  cloak: '#a855f7',
  heart: '#ec4899',
};

function paintItemGlyph(g, type, r) {
  const c = r; // 중심
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (type === 'umbrella') {
    g.beginPath(); // 우산 덮개
    g.arc(c, c + r * 0.12, r * 0.58, Math.PI, 0);
    g.fill();
    g.lineWidth = r * 0.14; // 손잡이 — 끝에 고리를 넣어야 버섯으로 안 보인다
    g.beginPath();
    g.moveTo(c, c + r * 0.12);
    g.lineTo(c, c + r * 0.48);
    g.stroke();
    g.beginPath();
    g.arc(c - r * 0.13, c + r * 0.48, r * 0.13, 0, Math.PI);
    g.stroke();
  } else if (type === 'heart') {
    const s = r * 0.5;
    g.beginPath();
    g.moveTo(c, c + s * 0.85);
    g.bezierCurveTo(c - s * 1.5, c - s * 0.3, c - s * 0.5, c - s * 1.2, c, c - s * 0.35);
    g.bezierCurveTo(c + s * 0.5, c - s * 1.2, c + s * 1.5, c - s * 0.3, c, c + s * 0.85);
    g.fill();
  } else if (type === 'fan') {
    g.lineWidth = r * 0.16; // 소용돌이
    g.beginPath();
    for (let i = 0; i <= 28; i += 1) {
      const t = (i / 28) * Math.PI * 2.6;
      const rad = r * 0.1 + (t / (Math.PI * 2.6)) * r * 0.5;
      const x = c + Math.cos(t) * rad;
      const y = c + Math.sin(t) * rad;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  } else if (type === 'cloak') {
    g.beginPath(); // 유령
    g.arc(c, c - r * 0.08, r * 0.46, Math.PI, 0);
    g.lineTo(c + r * 0.46, c + r * 0.42);
    for (let i = 0; i < 3; i += 1) {
      const x = c + r * 0.46 - (r * 0.92 * (i + 0.5)) / 3;
      g.quadraticCurveTo(x, c + r * 0.18, x - (r * 0.92) / 6, c + r * 0.42);
    }
    g.lineTo(c - r * 0.46, c - r * 0.08);
    g.fill();
    g.fillStyle = ITEM_COLORS.cloak; // 눈
    g.beginPath();
    g.arc(c - r * 0.16, c - r * 0.1, r * 0.09, 0, Math.PI * 2);
    g.arc(c + r * 0.16, c - r * 0.1, r * 0.09, 0, Math.PI * 2);
    g.fill();
  }
}

function paintItem(type) {
  return (g) => {
    const r = D.ITEM_R;
    g.fillStyle = ITEM_COLORS[type] || '#64748b';
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.5;
    g.stroke();
    paintItemGlyph(g, type, r);
  };
}

function paintPlayer(g) {
  const w = D.PLAYER_W;
  const h = D.PLAYER_H;
  // 다리
  g.fillStyle = '#1f2937';
  g.fillRect(w * 0.28, h * 0.78, w * 0.14, h * 0.22);
  g.fillRect(w * 0.58, h * 0.78, w * 0.14, h * 0.22);
  // 몸
  g.fillStyle = '#2563eb';
  fillRoundRect(g, w * 0.16, h * 0.42, w * 0.68, h * 0.4, 6);
  // 얼굴
  g.fillStyle = '#f8d7b0';
  g.beginPath();
  g.arc(w * 0.5, h * 0.28, w * 0.26, 0, Math.PI * 2);
  g.fill();
  // 머리
  g.fillStyle = '#27272a';
  g.beginPath();
  g.arc(w * 0.5, h * 0.26, w * 0.27, Math.PI, Math.PI * 2);
  g.fill();
  // 눈
  g.fillStyle = '#27272a';
  g.beginPath();
  g.arc(w * 0.41, h * 0.3, w * 0.035, 0, Math.PI * 2);
  g.arc(w * 0.59, h * 0.3, w * 0.035, 0, Math.PI * 2);
  g.fill();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let dpr = 1;
  let poopSprite = null;
  let bossSprite = null;
  let playerSprite = null;
  let itemSprites = {};
  let sky = null;

  function resize() {
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const pxW = Math.max(1, Math.round(rect.width * dpr));
    const pxH = Math.max(1, Math.round(rect.height * dpr));

    // iOS에서 주소창이 접히기만 해도 resize가 연달아 온다.
    // 실제 크기가 그대로면 스프라이트를 다시 만들지 않는다.
    if (canvas.width === pxW && canvas.height === pxH && sky) return;

    canvas.width = pxW;
    canvas.height = pxH;
    const sx = pxW / D.VIEW_W;
    const sy = pxH / D.VIEW_H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // sx·sy에 이미 devicePixelRatio가 포함돼 있다 (pxW = CSS 너비 × dpr)
    poopSprite = makeSprite(D.POOP_R * 2, D.POOP_R * 2, sx, (g) => paintPoop(g, D.POOP_R, false));
    bossSprite = makeSprite(D.BOSS_R * 2, D.BOSS_R * 2, sx, (g) => paintPoop(g, D.BOSS_R, true));
    playerSprite = makeSprite(D.PLAYER_W, D.PLAYER_H, sy, paintPlayer);
    itemSprites = {};
    for (const type of D.ITEM_TYPES) {
      itemSprites[type.id] = makeSprite(D.ITEM_R * 2, D.ITEM_R * 2, sx, paintItem(type.id));
    }

    sky = ctx.createLinearGradient(0, 0, 0, D.VIEW_H);
    sky.addColorStop(0, '#cfeaff');
    sky.addColorStop(1, '#f4fbff');
  }

  /**
   * 화면 좌표(clientX/Y) → 게임 논리 좌표.
   * 캔버스 위치를 캐시하지 않는다 — iOS에서 주소창이 접히면 캔버스가 위아래로
   * 움직이는데, 캐시된 값을 쓰면 터치 위치가 어긋난다.
   */
  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: D.VIEW_W / 2, y: D.VIEW_H };
    return {
      x: ((clientX - rect.left) / rect.width) * D.VIEW_W,
      y: ((clientY - rect.top) / rect.height) * D.VIEW_H,
    };
  }

  function draw(game) {
    if (!sky) resize();
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, D.VIEW_W, D.VIEW_H);

    // 바닥
    const groundY = D.VIEW_H - 14;
    ctx.fillStyle = '#bfe39a';
    ctx.fillRect(0, groundY, D.VIEW_W, D.VIEW_H - groundY);
    ctx.fillStyle = '#a5cf7c';
    ctx.fillRect(0, groundY, D.VIEW_W, 3);

    // 왕똥 예고 — 떨어질 자리를 미리 알려 준다 (예고 없으면 불공정하다)
    if (game.boss && game.boss.warnMs > 0) {
      const pulse = 0.25 + 0.2 * Math.sin((D.BOSS_WARN_MS - game.boss.warnMs) / 60);
      ctx.fillStyle = `rgba(239, 68, 68, ${pulse.toFixed(3)})`;
      ctx.fillRect(game.boss.x - D.BOSS_R, 0, D.BOSS_R * 2, groundY);
      ctx.fillStyle = 'rgba(127, 29, 29, 0.35)';
      ctx.beginPath();
      ctx.ellipse(game.boss.x, groundY - 4, D.BOSS_R, D.BOSS_R * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b91c1c';
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', game.boss.x, 46);
      ctx.textAlign = 'start';
    }

    // 똥
    for (const poop of game.poops) {
      ctx.save();
      ctx.translate(poop.x, poop.y);
      ctx.rotate(poop.rot * 0.15); // 살짝만 기울인다
      ctx.drawImage(poopSprite, -D.POOP_R, -D.POOP_R, D.POOP_R * 2, D.POOP_R * 2);
      ctx.restore();
    }

    // 왕똥 — 선풍기 바람이 부는 동안에는 버티느라 좌우로 떤다.
    // 날아가지 않는 게 규칙인데, 가만히 있으면 선풍기가 고장난 것처럼 보인다.
    if (game.boss && game.boss.warnMs <= 0) {
      const shake = game.fanFlashMs > 0 ? Math.sin(game.fanFlashMs / 18) * 4 : 0;
      ctx.drawImage(
        bossSprite,
        game.boss.x - D.BOSS_R + shake,
        game.boss.y - D.BOSS_R,
        D.BOSS_R * 2,
        D.BOSS_R * 2
      );
    }

    // 아이템 — 살짝 위아래로 흔들어 눈에 띄게 한다
    for (const item of game.items) {
      const sprite = itemSprites[item.type];
      if (!sprite) continue;
      const dy = Math.sin(item.bob) * 2;
      ctx.drawImage(sprite, item.x - D.ITEM_R, item.y - D.ITEM_R + dy, D.ITEM_R * 2, D.ITEM_R * 2);
    }

    // 플레이어
    const px = game.player.x - D.PLAYER_W / 2;
    const py = D.VIEW_H - D.PLAYER_BOTTOM - D.PLAYER_H;
    ctx.save();
    if (game.cloakMs > 0) {
      ctx.globalAlpha = 0.4; // 투명망토 — 반투명
    } else if (game.invulnMs > 0) {
      // 맞은 직후 깜빡임: 지금 무적이라는 걸 눈으로 알 수 있어야 한다
      ctx.globalAlpha = Math.floor(game.invulnMs / 100) % 2 === 0 ? 0.35 : 1;
    }
    ctx.drawImage(playerSprite, px, py, D.PLAYER_W, D.PLAYER_H);
    ctx.restore();

    // 우산 — 머리 위에 씌우고, 남은 횟수만큼 살이 진하다
    if (game.umbrella > 0) {
      const cx = game.player.x;
      const cy = py - 6;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy, 22, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#fca5a5';
      ctx.fillRect(cx - 22, cy - 1, 44, 3);
      ctx.fillStyle = '#7f1d1d';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(game.umbrella), cx, cy - 6);
      ctx.textAlign = 'start';
    }

    // 선풍기 바람 — 똥이 소리 없이 사라지면 먹었는지도 모른다.
    // 특히 높은 레벨에서는 2초 안에 화면이 다시 차서 아무 일도 없었던 것처럼 보인다.
    if (game.fanFlashMs > 0) {
      const t = game.fanFlashMs / 450; // 1 → 0
      ctx.save();
      ctx.globalAlpha = t * 0.75;
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 7; i += 1) {
        const y = ((i + 0.5) / 7) * D.VIEW_H;
        const sweep = (1 - t) * D.VIEW_W * 1.6;
        const len = 40 + (i % 3) * 26;
        const x = -60 + sweep + (i % 2) * 40;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 맞은 순간 화면을 붉게 (목숨이 줄었다는 신호)
    if (game.hurtFlashMs > 0) {
      ctx.fillStyle = `rgba(239, 68, 68, ${(game.hurtFlashMs / 400) * 0.35})`;
      ctx.fillRect(0, 0, D.VIEW_W, D.VIEW_H);
    }

    if (game.over) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
      ctx.fillRect(0, 0, D.VIEW_W, D.VIEW_H);
      const rect = playerRect(game);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  return { resize, draw, toLogical };
}
