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

function paintPoop(g) {
  const r = D.POOP_R;
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
  let playerSprite = null;
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
    poopSprite = makeSprite(D.POOP_R * 2, D.POOP_R * 2, sx, paintPoop);
    playerSprite = makeSprite(D.PLAYER_W, D.PLAYER_H, sy, paintPlayer);

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

    // 똥
    for (const poop of game.poops) {
      ctx.save();
      ctx.translate(poop.x, poop.y);
      ctx.rotate(poop.rot * 0.15); // 살짝만 기울인다
      ctx.drawImage(poopSprite, -D.POOP_R, -D.POOP_R, D.POOP_R * 2, D.POOP_R * 2);
      ctx.restore();
    }

    // 플레이어
    const px = game.player.x - D.PLAYER_W / 2;
    const py = D.VIEW_H - D.PLAYER_BOTTOM - D.PLAYER_H;
    ctx.drawImage(playerSprite, px, py, D.PLAYER_W, D.PLAYER_H);

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
