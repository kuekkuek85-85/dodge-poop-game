// GET /api/teacher/export?classNo=3 — 반 기록 CSV (classNo=0 이면 전체)
// 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.

import { allowMethod, fail, getQuery } from '../../lib/http.js';
import { requireTeacher } from '../../lib/guard.js';
import { store } from '../../lib/store.js';
import { CLASS_MAX, CLASS_MIN } from '../../public/js/shared/config.js';

const BOM = '\uFEFF'; // 엑셀이 UTF-8로 인식하게 하는 표식

const HEADER = ['학년', '반', '번호', '이름', '점수', '생존시간(초)', '레벨', '기록시각', '이상기록', '사유'];

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // 앞이 =,+,-,@ 로 시작하면 엑셀이 수식으로 해석한다 → 앞에 작은따옴표를 붙여 무력화
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Vercel 서버 시간은 UTC라 그대로 쓰면 9시간 어긋난다 → 한국 시간으로 고정한다
const KST = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatTime(ms) {
  if (!Number.isFinite(ms)) return '';
  return KST.format(new Date(ms));
}

export default async function handler(req, res) {
  if (!allowMethod(req, res, ['GET'])) return;
  if (!requireTeacher(req, res)) return;

  const n = Number(getQuery(req).classNo);
  if (!Number.isInteger(n) || n < 0 || n > CLASS_MAX || (n !== 0 && n < CLASS_MIN)) {
    return fail(res, 400, 'BAD_CLASS', '반이 올바르지 않습니다.');
  }

  const rows = await store.listClassRecords(n === 0 ? null : n);
  const lines = [HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.grade,
        r.classNo,
        r.studentNo,
        r.name,
        r.score,
        (r.survivedMs / 1000).toFixed(1),
        r.level,
        formatTime(r.createdAt),
        r.flagged ? 'Y' : '',
        r.flagReason || '',
      ]
        .map(csvCell)
        .join(',')
    );
  }

  const filename = n === 0 ? 'dodge-all.csv' : `dodge-class${n}.csv`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(BOM + lines.join('\r\n'));
}
