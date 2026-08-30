// GET /api/leaderboard?scope=class&classNo=3[&me=1-3-14]
// GET /api/leaderboard?scope=all[&me=1-3-14]
//
// 이름은 서버에서 마스킹해서 내보낸다. 학번(key)은 응답에 담지 않고,
// 본인 행 여부만 me 플래그로 알려 준다.

import { allowMethod, fail, getQuery, ok } from '../lib/http.js';
import { maskName } from '../lib/mask.js';
import { store } from '../lib/store.js';
import { ALL_BOARD_LIMIT, CLASS_MAX, CLASS_MIN, DASHBOARD_POLL_MS } from '../public/js/shared/config.js';

/** 서버리스 인스턴스 안에서만 사는 짧은 캐시 — 접속자가 늘어도 DB 조회는 그대로 */
const cache = new Map();

async function cached(cacheKey, loader) {
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await loader();
  cache.set(cacheKey, { value, expiresAt: now + DASHBOARD_POLL_MS });
  return value;
}

export default async function handler(req, res) {
  if (!allowMethod(req, res, ['GET'])) return;

  const { scope = 'class', classNo, me, reveal } = getQuery(req);
  // PRD 4.3 — 기본은 마스킹, 학생이 직접 "전체 표시"로 바꿀 수 있다
  const showFullName = reveal === '1';

  let board;
  if (scope === 'all') {
    board = await cached('all', () => store.getAllBoard(ALL_BOARD_LIMIT));
  } else {
    const n = Number(classNo);
    if (!Number.isInteger(n) || n < CLASS_MIN || n > CLASS_MAX) {
      return fail(res, 400, 'BAD_CLASS', '반이 올바르지 않습니다.');
    }
    board = await cached(`class:${n}`, () => store.getClassBoard(n));
  }

  const rows = board.entries.map((entry, index) => ({
    rank: index + 1,
    classNo: entry.classNo,
    name: showFullName ? entry.name : maskName(entry.name),
    score: entry.score,
    level: entry.level,
    survivedMs: entry.survivedMs,
    me: me ? entry.key === me : false,
  }));

  return ok(res, { scope, rows, updatedAt: board.updatedAt });
}
