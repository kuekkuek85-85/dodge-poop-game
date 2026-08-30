// 원(똥)과 사각형(플레이어)의 충돌 판정.

/**
 * @param {number} cx 원 중심 x
 * @param {number} cy 원 중심 y
 * @param {number} r  원 반지름
 * @param {number} rx 사각형 좌측 x
 * @param {number} ry 사각형 상단 y
 * @param {number} rw 사각형 너비
 * @param {number} rh 사각형 높이
 */
export function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  // 사각형 안에서 원 중심과 가장 가까운 점
  const nearestX = cx < rx ? rx : cx > rx + rw ? rx + rw : cx;
  const nearestY = cy < ry ? ry : cy > ry + rh ? ry + rh : cy;
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy <= r * r;
}
