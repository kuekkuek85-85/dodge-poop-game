// 교사 전용 API 앞단 가드.

import { fail } from './http.js';
import { hasTeacherSession } from './session.js';

export function requireTeacher(req, res) {
  if (hasTeacherSession(req)) return true;
  fail(res, 401, 'UNAUTHORIZED', '교사 모드 로그인이 필요합니다.');
  return false;
}
