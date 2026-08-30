// 조작 입력. 키보드와 터치를 동시에 열어 두고 기기 판별은 하지 않는다.
//
//  - 키보드: ← → (또는 A / D)
//  - 화면 위쪽 좌·우 절반: 누르고 있는 동안 그 방향으로 이동
//  - 화면 아래쪽 띠: 손가락을 따라 캐릭터가 움직임 (드래그)

import { VIEW_W, VIEW_H } from '../shared/difficulty.js';

/** 이 높이보다 아래를 누르면 드래그 모드 */
const DRAG_BAND_RATIO = 0.72;

export function createInput(surface, toLogical) {
  const keys = { left: false, right: false };
  const pointer = { id: null, dir: 0, targetX: null };
  let lastPointerKind = null; // 'zone' | 'drag' | null

  function onKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    else return;
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  }

  function applyPointer(e) {
    const { x, y } = toLogical(e.clientX, e.clientY);
    if (lastPointerKind === null) {
      lastPointerKind = y >= VIEW_H * DRAG_BAND_RATIO ? 'drag' : 'zone';
    }
    if (lastPointerKind === 'drag') {
      pointer.targetX = x;
      pointer.dir = 0;
    } else {
      pointer.targetX = null;
      pointer.dir = x < VIEW_W / 2 ? -1 : 1;
    }
  }

  function onPointerDown(e) {
    if (pointer.id !== null) return;
    pointer.id = e.pointerId;
    lastPointerKind = null;
    if (surface.setPointerCapture) {
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        /* 캡처 실패는 무시 — 이동은 계속 동작한다 */
      }
    }
    applyPointer(e);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (pointer.id !== e.pointerId) return;
    applyPointer(e);
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (pointer.id !== e.pointerId) return;
    pointer.id = null;
    pointer.dir = 0;
    pointer.targetX = null;
    lastPointerKind = null;
  }

  function attach() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerUp);
    surface.addEventListener('pointercancel', onPointerUp);
  }

  function detach() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', onPointerUp);
    surface.removeEventListener('pointercancel', onPointerUp);
  }

  function reset() {
    keys.left = false;
    keys.right = false;
    pointer.id = null;
    pointer.dir = 0;
    pointer.targetX = null;
    lastPointerKind = null;
  }

  /** 게임 루프가 매 틱 읽어가는 현재 조작 상태 */
  function read() {
    if (pointer.targetX !== null) return { dir: 0, targetX: pointer.targetX };
    if (pointer.dir !== 0) return { dir: pointer.dir, targetX: null };
    const dir = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
    return { dir, targetX: null };
  }

  return { attach, detach, reset, read };
}
