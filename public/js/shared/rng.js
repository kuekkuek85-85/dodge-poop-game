// 재현 가능한 난수.
//
// 이 게임은 Math.random을 쓰지 않는다. 판이 시작될 때 정해진 씨앗에서 난수를
// 뽑기 때문에, **모든 학생이 언제나 똑같은 배치**를 만난다. 그래서 여러 번
// 해 본 학생이 배치를 알고 더 잘하게 되고, 순위표도 같은 문제를 푼 결과끼리
// 비교하게 된다.
//
// 난수의 현재 상태를 게임 객체에 숫자 하나로 들고 다닌다(감춰 두지 않는다).
// 그래야 게임 상태를 통째로 복사해 "이렇게 움직이면 어떻게 될까"를 미리
// 굴려 볼 수 있다 — 복사본이 원본의 난수를 건드리지 않는다.
//
// 선형 합동법 — 짧고 빠르고, 어느 기기에서나 같은 값이 나온다.

const A = 1664525;
const C = 1013904223;

/** 다음 상태 */
export function nextState(state) {
  return (state * A + C) >>> 0;
}

/** 상태 → 0 이상 1 미만 */
export function toUnit(state) {
  return state / 4294967296;
}

/** 상태를 안에 감춰 둔 난수기 (스크립트에서 쓴다) */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = nextState(s);
    return toUnit(s);
  };
}
