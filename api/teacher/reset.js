// POST /api/teacher/reset  { classNo: 3, confirm: "3반" }
// POST /api/teacher/reset  { all: true, confirm: "전체삭제" }
//
// 되돌릴 수 없는 작업이라 확인 문구를 정확히 입력해야 실행된다.

import { allowMethod, fail, ok, readBody } from '../../lib/http.js';
import { requireTeacher } from '../../lib/guard.js';
import { store } from '../../lib/store.js';
import { CLASS_MAX, CLASS_MIN } from '../../public/js/shared/config.js';

export const ALL_CONFIRM = '전체삭제';

export default async function handler(req, res) {
  if (!allowMethod(req, res, ['POST'])) return;
  if (!requireTeacher(req, res)) return;

  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(res, 413, 'BODY_TOO_LARGE', '요청이 너무 큽니다.');
  }

  const confirm = String(body?.confirm ?? '').trim();

  if (body?.all === true) {
    if (confirm !== ALL_CONFIRM) {
      return fail(res, 400, 'CONFIRM_REQUIRED', `확인 문구 "${ALL_CONFIRM}"를 정확히 입력해 주세요.`);
    }
    const result = await store.resetAll();
    return ok(res, { scope: 'all', deleted: result.deleted });
  }

  const n = Number(body?.classNo);
  if (!Number.isInteger(n) || n < CLASS_MIN || n > CLASS_MAX) {
    return fail(res, 400, 'BAD_CLASS', '반이 올바르지 않습니다.');
  }
  if (confirm !== `${n}반`) {
    return fail(res, 400, 'CONFIRM_REQUIRED', `확인 문구 "${n}반"을 정확히 입력해 주세요.`);
  }

  const result = await store.resetClass(n);
  return ok(res, { scope: 'class', classNo: n, deleted: result.deleted });
}
