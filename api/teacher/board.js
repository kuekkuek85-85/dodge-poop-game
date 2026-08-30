// GET /api/teacher/board?classNo=3   — 반 순위 + 참여 현황 (투사용)
// GET /api/teacher/board?classNo=0   — 전체 순위
//
// 학생용 대시보드와 달리 실명으로 내려보낸다.

import { allowMethod, fail, getQuery, ok } from '../../lib/http.js';
import { requireTeacher } from '../../lib/guard.js';
import { store } from '../../lib/store.js';
import { ALL_BOARD_LIMIT, CLASS_MAX, CLASS_MIN } from '../../public/js/shared/config.js';

export default async function handler(req, res) {
  if (!allowMethod(req, res, ['GET'])) return;
  if (!requireTeacher(req, res)) return;

  const { classNo } = getQuery(req);
  const n = Number(classNo);
  if (!Number.isInteger(n) || n < 0 || n > CLASS_MAX) {
    return fail(res, 400, 'BAD_CLASS', '반이 올바르지 않습니다.');
  }

  if (n === 0) {
    const board = await store.getAllBoard(ALL_BOARD_LIMIT);
    return ok(res, {
      classNo: 0,
      rows: board.entries.map((e, i) => ({
        rank: i + 1,
        classNo: e.classNo,
        studentNo: e.studentNo,
        name: e.name,
        score: e.score,
        level: e.level,
        survivedMs: e.survivedMs,
        key: e.key,
      })),
      participation: null,
    });
  }

  if (n < CLASS_MIN) return fail(res, 400, 'BAD_CLASS', '반이 올바르지 않습니다.');

  const board = await store.getClassBoard(n);
  const rows = board.entries.map((e, i) => ({
    rank: i + 1,
    classNo: e.classNo,
    studentNo: e.studentNo,
    name: e.name,
    score: e.score,
    level: e.level,
    survivedMs: e.survivedMs,
    key: e.key,
  }));

  const numbers = [...new Set(board.entries.map((e) => e.studentNo))].sort((a, b) => a - b);

  return ok(res, {
    classNo: n,
    rows,
    participation: { participants: numbers.length, numbers },
    updatedAt: board.updatedAt,
  });
}
