// GET /api/teacher/flagged?classNo=3 — 정합성 검사에 걸린 기록 목록
// 순위 보드 폴링과 분리해 두어, 필요할 때만 조회한다.

import { allowMethod, fail, getQuery, ok } from '../../lib/http.js';
import { requireTeacher } from '../../lib/guard.js';
import { store } from '../../lib/store.js';
import { CLASS_MAX, CLASS_MIN } from '../../public/js/shared/config.js';

export default async function handler(req, res) {
  if (!allowMethod(req, res, ['GET'])) return;
  if (!requireTeacher(req, res)) return;

  const n = Number(getQuery(req).classNo);
  if (!Number.isInteger(n) || n < CLASS_MIN || n > CLASS_MAX) {
    return fail(res, 400, 'BAD_CLASS', '반이 올바르지 않습니다.');
  }

  const rows = await store.listFlagged(n);
  return ok(res, {
    rows: rows.map((r) => ({
      id: r.id,
      classNo: r.classNo,
      studentNo: r.studentNo,
      name: r.name,
      score: r.score,
      survivedMs: r.survivedMs,
      level: r.level,
      reason: r.flagReason,
      createdAt: r.createdAt,
    })),
  });
}
