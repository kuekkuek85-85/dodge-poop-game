// DELETE /api/teacher/record?id=<기록ID>          — 회차 1건 삭제
// DELETE /api/teacher/record?studentKey=1-3-14    — 그 학생의 기록 전체 삭제
//
// 삭제 후에는 해당 학생의 최고 기록과 반 순위표를 다시 계산한다.

import { allowMethod, fail, getQuery, ok } from '../../lib/http.js';
import { requireTeacher } from '../../lib/guard.js';
import { store } from '../../lib/store.js';

const KEY_PATTERN = /^\d{1,2}-\d{1,2}-\d{1,2}$/;

export default async function handler(req, res) {
  if (!allowMethod(req, res, ['DELETE'])) return;
  if (!requireTeacher(req, res)) return;

  const { id, studentKey } = getQuery(req);

  if (studentKey) {
    if (!KEY_PATTERN.test(studentKey)) return fail(res, 400, 'BAD_KEY', '학생 키가 올바르지 않습니다.');
    const result = await store.deleteStudent(studentKey);
    return ok(res, { deleted: result.deleted });
  }

  if (!id || typeof id !== 'string') return fail(res, 400, 'BAD_ID', '삭제할 기록을 지정해 주세요.');
  const result = await store.deleteRecord(id);
  if (!result.deleted) return fail(res, 404, 'NOT_FOUND', '이미 삭제된 기록입니다.');
  return ok(res, { deleted: result.deleted });
}
