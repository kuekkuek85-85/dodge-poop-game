// localStorage 래퍼. 사파리 개인정보 보호 모드 등에서 예외가 나도 게임은 계속 돌아가야 한다.

const PROFILE_KEY = 'dodge.profile';
const BEST_PREFIX = 'dodge.best.';
const QUEUE_KEY = 'dodge.queue';
const RECENT_PREFIX = 'dodge.recent.';
const REVEAL_KEY = 'dodge.reveal';

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadProfile() {
  const p = read(PROFILE_KEY);
  if (!p || typeof p !== 'object') return null;
  const { grade, classNo, studentNo, name } = p;
  if (!Number.isInteger(classNo) || !Number.isInteger(studentNo) || !name) return null;
  return { grade: grade || 1, classNo, studentNo, name };
}

export function saveProfile(profile) {
  write(PROFILE_KEY, profile);
}

export function loadBest(studentKey) {
  const v = read(BEST_PREFIX + studentKey);
  return Number.isFinite(v) ? v : 0;
}

export function saveBest(studentKey, score) {
  if (score > loadBest(studentKey)) write(BEST_PREFIX + studentKey, score);
}

/** 서버 응답이 오기 전에 먼저 그릴 로컬 회차 목록 */
export function loadRecent(studentKey) {
  const list = read(RECENT_PREFIX + studentKey);
  return Array.isArray(list) ? list : [];
}

export function pushRecent(studentKey, entry, limit = 20) {
  const list = [entry, ...loadRecent(studentKey)].slice(0, limit);
  write(RECENT_PREFIX + studentKey, list);
  return list;
}

/**
 * 서버 기록으로 로컬 캐시를 맞춘다.
 *
 * 캐시를 쌓기만 하고 줄이지 않으면, 교사가 기록을 초기화한 뒤에도 지워진
 * 기록이 "내 기록"에 계속 남는다. 서버가 정답이다.
 *
 * 다만 **아직 못 보낸** 기록은 남긴다 — 대기열에 있는 것이 그것이다.
 * 그러지 않으면 오프라인에서 한 판이 화면에서 사라진다.
 */
export function syncRecent(studentKey, serverRecords, limit = 20) {
  const pending = loadQueue();
  const unsent = loadRecent(studentKey).filter((r) =>
    pending.some((q) => q.survivedMs === r.survivedMs && q.score === r.score)
  );
  const merged = [...unsent, ...(serverRecords || [])]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
  write(RECENT_PREFIX + studentKey, merged);
  return merged;
}

/**
 * 서버가 알려 준 최고 기록으로 맞춘다 (saveBest와 달리 낮은 값으로도 내린다).
 * 초기화 뒤에도 옛 최고 점수가 남아 있으면 학생에게 없는 기록을 보여 준다.
 */
export function syncBest(studentKey, score) {
  write(BEST_PREFIX + studentKey, Math.max(0, Number(score) || 0));
}

/** 네트워크가 끊겼을 때 저장하지 못한 기록을 담아 둔다 */
export function loadQueue() {
  const list = read(QUEUE_KEY);
  return Array.isArray(list) ? list : [];
}

export function saveQueue(list) {
  write(QUEUE_KEY, list.slice(-20));
}

export function loadReveal() {
  return read(REVEAL_KEY) === true;
}

export function saveReveal(value) {
  write(REVEAL_KEY, value === true);
}
