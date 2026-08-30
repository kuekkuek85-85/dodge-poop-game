// 교사 모드 — 순위 투사, 참여 현황, 이상 기록 정리, CSV, 초기화.

import { request, ApiError } from './api.js';
import { classList, DASHBOARD_POLL_MS } from './shared/config.js';

const EXPECTED_KEY = 'dodge.teacher.expected';

const screenLogin = document.getElementById('screen-login');
const screenBoard = document.getElementById('screen-board');
const loginForm = document.getElementById('loginForm');
const inputCode = document.getElementById('inputCode');
const loginError = document.getElementById('loginError');
const selClass = document.getElementById('selClass');
const participation = document.getElementById('participation');
const boardList = document.getElementById('boardList');
const toolPanel = document.getElementById('toolPanel');
const toolMessage = document.getElementById('toolMessage');
const flaggedPanel = document.getElementById('flaggedPanel');
const inputExpected = document.getElementById('inputExpected');
const linkCsv = document.getElementById('linkCsv');

let timer = 0;

function option(value, label) {
  const el = document.createElement('option');
  el.value = String(value);
  el.textContent = label;
  return el;
}

selClass.append(option(0, '전체'));
for (const n of classList()) selClass.append(option(n, `${n}반`));
selClass.value = '1';

function currentClass() {
  return Number(selClass.value);
}

function expectedKey() {
  return `${EXPECTED_KEY}.${currentClass()}`;
}

// 사파리 개인정보 보호 모드 등에서는 localStorage 접근 자체가 예외를 던진다.
// 순위 보드가 그것 때문에 멈추면 안 된다.
function loadExpected() {
  try {
    const n = Number(window.localStorage.getItem(expectedKey()));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function storeExpected(n) {
  try {
    if (Number.isInteger(n) && n > 0) window.localStorage.setItem(expectedKey(), String(n));
    else window.localStorage.removeItem(expectedKey());
  } catch {
    /* 저장하지 못해도 이번 세션 화면 표시에는 지장이 없다 */
  }
}

function setMessage(text, isError = false) {
  toolMessage.textContent = text;
  toolMessage.classList.toggle('is-error', isError);
}

function message(text) {
  const p = document.createElement('p');
  p.className = 'board-empty';
  p.textContent = text;
  return p;
}

function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderRows(rows, showClass) {
  if (!rows.length) {
    boardList.replaceChildren(message('아직 기록이 없습니다.'));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 't-row';

    const rank = document.createElement('span');
    rank.className = 't-rank';
    rank.textContent = String(row.rank);

    const name = document.createElement('span');
    name.className = 't-name';
    const small = document.createElement('small');
    small.textContent = showClass ? `${row.classNo}반 ${row.studentNo}번` : `${row.studentNo}번`;
    const strong = document.createElement('b');
    strong.textContent = row.name;
    name.append(small, strong);

    const score = document.createElement('span');
    score.className = 't-score';
    score.textContent = String(row.score);

    const meta = document.createElement('span');
    meta.className = 't-meta';
    meta.textContent = `LV ${row.level} · ${(row.survivedMs / 1000).toFixed(1)}초`;

    const del = document.createElement('button');
    del.className = 't-del';
    del.type = 'button';
    del.textContent = '삭제';
    del.addEventListener('click', () => deleteStudent(row));

    meta.append(del);
    el.append(rank, name, score, meta);
    frag.append(el);
  }
  boardList.replaceChildren(frag);
}

function renderParticipation(data) {
  if (!data) {
    participation.textContent = '';
    return;
  }
  const expected = loadExpected();
  let text = `참여 ${data.participants}명`;
  if (expected) {
    const joined = new Set(data.numbers);
    const missing = [];
    for (let n = 1; n <= expected; n += 1) if (!joined.has(n)) missing.push(n);
    text += ` / ${expected}명 · 미참여 ${missing.length}명`;
    if (missing.length) text += ` (${missing.join(', ')}번)`;
  }
  participation.textContent = text;
}

let requestSeq = 0;

/**
 * 순위 보드를 다시 그린다.
 *
 * 연결이 느리면 이전 반 요청이 나중에 도착할 수 있다. 그대로 그리면 투사 화면에
 * 다른 반 순위가 뜨므로, 요청 번호를 붙여 뒤늦게 온 응답은 버린다.
 */
async function refresh() {
  const classNo = currentClass();
  const my = ++requestSeq;
  linkCsv.href = `/api/teacher/export?classNo=${classNo}`;
  try {
    const res = await request(`/api/teacher/board?classNo=${classNo}`);
    if (my !== requestSeq) return; // 그 사이 다른 반을 골랐다
    renderRows(res.rows, classNo === 0);
    renderParticipation(res.participation);
  } catch (err) {
    if (my !== requestSeq) return;
    if (err instanceof ApiError && err.status === 401) {
      showLogin();
      return;
    }
    if (!boardList.querySelector('.t-row')) {
      boardList.replaceChildren(message('불러오지 못했습니다.'));
    }
  }
}

async function deleteStudent(row) {
  const label = `${row.classNo}반 ${row.studentNo}번 ${row.name}`;
  if (!window.confirm(`${label} 학생의 기록을 모두 삭제할까요?`)) return;
  try {
    const res = await request(`/api/teacher/record?studentKey=${encodeURIComponent(row.key)}`, {
      method: 'DELETE',
    });
    setMessage(`${label} 기록 ${res.deleted}건을 삭제했습니다.`);
    refresh();
  } catch (err) {
    setMessage(err.message || '삭제하지 못했습니다.', true);
  }
}

async function loadFlagged() {
  const classNo = currentClass();
  if (classNo === 0) {
    setMessage('이상 기록은 반을 선택한 뒤에 볼 수 있습니다.', true);
    return;
  }
  try {
    const res = await request(`/api/teacher/flagged?classNo=${classNo}`);
    flaggedPanel.hidden = false;
    if (!res.rows.length) {
      flaggedPanel.replaceChildren(message('이상 기록이 없습니다.'));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const row of res.rows) {
      const line = document.createElement('div');
      const text = document.createElement('span');
      text.textContent = `${row.studentNo}번 ${row.name} · ${row.score}점 · ${(row.survivedMs / 1000).toFixed(1)}초 · ${row.reason} · ${formatTime(row.createdAt)}`;
      const del = document.createElement('button');
      del.className = 't-del';
      del.type = 'button';
      del.textContent = '삭제';
      del.addEventListener('click', async () => {
        try {
          await request(`/api/teacher/record?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
          line.remove();
          setMessage('이상 기록 1건을 삭제했습니다.');
          refresh();
        } catch (err) {
          setMessage(err.message || '삭제하지 못했습니다.', true);
        }
      });
      line.append(text, del);
      frag.append(line);
    }
    flaggedPanel.replaceChildren(frag);
  } catch (err) {
    setMessage(err.message || '이상 기록을 불러오지 못했습니다.', true);
  }
}

async function resetClass() {
  const classNo = currentClass();
  if (classNo === 0) {
    setMessage('초기화할 반을 선택해 주세요.', true);
    return;
  }
  const confirm = window.prompt(`${classNo}반 기록을 모두 지웁니다. 확인을 위해 "${classNo}반"을 입력하세요.`);
  if (confirm === null) return;
  try {
    const res = await request('/api/teacher/reset', {
      method: 'POST',
      body: { classNo, confirm: confirm.trim() },
    });
    setMessage(`${classNo}반 기록 ${res.deleted}건을 삭제했습니다.`);
    refresh();
  } catch (err) {
    setMessage(err.message || '초기화하지 못했습니다.', true);
  }
}

async function resetAll() {
  const confirm = window.prompt('모든 반의 기록을 지웁니다. 확인을 위해 "전체삭제"를 입력하세요.');
  if (confirm === null) return;
  try {
    const res = await request('/api/teacher/reset', {
      method: 'POST',
      body: { all: true, confirm: confirm.trim() },
    });
    setMessage(`전체 기록 ${res.deleted}건을 삭제했습니다.`);
    refresh();
  } catch (err) {
    setMessage(err.message || '삭제하지 못했습니다.', true);
  }
}

function startPolling() {
  stopPolling();
  timer = setInterval(refresh, DASHBOARD_POLL_MS);
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = 0;
}

function showBoard() {
  screenLogin.hidden = true;
  screenBoard.hidden = false;
  inputExpected.value = loadExpected() ?? '';
  refresh();
  startPolling();
}

function showLogin() {
  stopPolling();
  screenBoard.hidden = true;
  screenLogin.hidden = false;
  inputCode.value = '';
  inputCode.focus();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  try {
    await request('/api/teacher/login', { method: 'POST', body: { code: inputCode.value } });
    showBoard();
  } catch (err) {
    loginError.textContent = err.message || '로그인하지 못했습니다.';
    loginError.hidden = false;
  }
});

selClass.addEventListener('change', () => {
  flaggedPanel.hidden = true;
  inputExpected.value = loadExpected() ?? '';
  boardList.replaceChildren(message('불러오는 중…'));
  refresh();
});

inputExpected.addEventListener('change', () => {
  storeExpected(Number(inputExpected.value));
  refresh();
});

document.getElementById('btnTools').addEventListener('click', () => {
  toolPanel.hidden = !toolPanel.hidden;
});

document.getElementById('btnBig').addEventListener('click', async () => {
  document.body.classList.toggle('projection');
  if (document.body.classList.contains('projection') && document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* 전체 화면 권한이 없어도 큰 글씨 모드는 그대로 동작한다 */
    }
  } else if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
});

document.getElementById('btnFlagged').addEventListener('click', loadFlagged);
document.getElementById('btnResetClass').addEventListener('click', resetClass);
document.getElementById('btnResetAll').addEventListener('click', resetAll);
document.getElementById('btnLogout').addEventListener('click', async () => {
  await request('/api/teacher/login', { method: 'DELETE' }).catch(() => {});
  showLogin();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else if (!screenBoard.hidden) startPolling();
});

// 이미 로그인돼 있으면 바로 보드로
request('/api/teacher/login')
  .then((res) => (res.authed ? showBoard() : showLogin()))
  .catch(() => showLogin());
