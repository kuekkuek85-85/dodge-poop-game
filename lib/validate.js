// 입력 검증과 기록 정합성 검사.

import {
  CLASS_MAX,
  CLASS_MIN,
  GRADE,
  MAX_SURVIVED_MS,
  NAME_MAX_LEN,
  STUDENT_NO_MAX,
  STUDENT_NO_MIN,
  studentKey,
} from '../public/js/shared/config.js';
import { levelAt, scoreAt, MAX_LEVEL } from '../public/js/shared/difficulty.js';

/** 이름에 허용할 문자: 한글·영문·숫자·공백 (기호로 순위표를 어지럽히지 못하게) */
const NAME_PATTERN = /^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ]+$/;

function asInt(value) {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isInteger(n) ? n : null;
}

export function normalizeName(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX_LEN);
}

export function validateIdentity(input) {
  if (!input || typeof input !== 'object') return { ok: false, code: 'BAD_INPUT', message: '입력이 없습니다.' };

  const grade = asInt(input.grade);
  const classNo = asInt(input.classNo);
  const studentNo = asInt(input.studentNo);
  const name = normalizeName(input.name);

  if (grade !== GRADE) return { ok: false, code: 'BAD_GRADE', message: '학년이 올바르지 않습니다.' };
  if (classNo === null || classNo < CLASS_MIN || classNo > CLASS_MAX) {
    return { ok: false, code: 'BAD_CLASS', message: '반을 선택해 주세요.' };
  }
  if (studentNo === null || studentNo < STUDENT_NO_MIN || studentNo > STUDENT_NO_MAX) {
    return { ok: false, code: 'BAD_STUDENT_NO', message: `번호는 ${STUDENT_NO_MIN}~${STUDENT_NO_MAX} 사이입니다.` };
  }
  if (!name) return { ok: false, code: 'BAD_NAME', message: '이름을 입력해 주세요.' };
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, code: 'BAD_NAME', message: '이름에는 한글·영문·숫자만 쓸 수 있습니다.' };
  }

  return {
    ok: true,
    value: { grade, classNo, studentNo, name, studentKey: studentKey(grade, classNo, studentNo) },
  };
}

export function validateAttempt(input) {
  if (!input || typeof input !== 'object') return { ok: false, code: 'BAD_INPUT', message: '입력이 없습니다.' };

  const score = asInt(input.score);
  const survivedMs = asInt(input.survivedMs);
  const level = asInt(input.level);

  if (score === null || score < 0) return { ok: false, code: 'BAD_SCORE', message: '점수가 올바르지 않습니다.' };
  if (survivedMs === null || survivedMs < 0) {
    return { ok: false, code: 'BAD_TIME', message: '생존 시간이 올바르지 않습니다.' };
  }
  if (survivedMs > MAX_SURVIVED_MS) return { ok: false, code: 'TIME_TOO_LONG', message: '생존 시간이 비정상입니다.' };
  if (level === null || level < 1 || level > MAX_LEVEL) {
    return { ok: false, code: 'BAD_LEVEL', message: '레벨이 올바르지 않습니다.' };
  }

  return { ok: true, value: { score, survivedMs, level } };
}

/**
 * 점수·레벨이 생존 시간에서 나올 수 있는 값인지 확인한다.
 * 점수 공식이 생존 시간만의 함수이므로 "정확히 일치"를 요구할 수 있다.
 */
export function checkConsistency({ score, survivedMs, level }) {
  const expectedScore = scoreAt(survivedMs);
  if (score !== expectedScore) {
    return { ok: false, reason: 'SCORE_MISMATCH', expectedScore };
  }
  const expectedLevel = levelAt(survivedMs);
  if (level !== expectedLevel) {
    return { ok: false, reason: 'LEVEL_MISMATCH', expectedLevel };
  }
  return { ok: true, expectedScore };
}
