// 게임 방법 안내 팝업.
//
// 접속하면 뜨고, "오늘 하루" 또는 "일주일간" 안 보기를 고를 수 있다.
// 고른 기간은 브라우저에 "언제까지 숨길지"를 시각으로 저장한다 — 날짜를
// 저장하면 자정을 넘겼는지 따로 따져야 하지만, 시각 하나면 비교로 끝난다.

const KEY = 'dodge.rulesHideUntil';
const DAY_MS = 24 * 60 * 60 * 1000;

/** 태블릿을 나눠 쓰면 저장이 막혀 있을 수 있다 — 그래도 게임은 돌아가야 한다 */
function readHideUntil() {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeHideUntil(ms) {
  try {
    if (ms > 0) localStorage.setItem(KEY, String(ms));
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장이 막혀 있으면 이번만 안 보이고 만다 */
  }
}

/** 오늘 자정까지 (자정이 지나면 다시 뜬다) */
function endOfToday() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function createRulesModal() {
  const modal = document.getElementById('rulesModal');
  const btnClose = document.getElementById('btnRulesClose');
  const btnOpen = document.getElementById('btnRules');
  const hideToday = document.getElementById('hideToday');
  const hideWeek = document.getElementById('hideWeek');

  // 둘 다 켜면 어느 쪽인지 모호하다 — 하나만 켜지게 한다
  hideToday.addEventListener('change', () => {
    if (hideToday.checked) hideWeek.checked = false;
  });
  hideWeek.addEventListener('change', () => {
    if (hideWeek.checked) hideToday.checked = false;
  });

  function open() {
    // 다시 열 때는 지난 선택을 지우고 시작한다 (체크가 남아 있으면 헷갈린다)
    hideToday.checked = false;
    hideWeek.checked = false;
    modal.hidden = false;
    btnClose.focus();
  }

  function close() {
    if (hideWeek.checked) writeHideUntil(Date.now() + 7 * DAY_MS);
    else if (hideToday.checked) writeHideUntil(endOfToday());
    modal.hidden = true;
  }

  btnClose.addEventListener('click', close);
  btnOpen.addEventListener('click', open);
  // 카드 바깥을 누르면 닫힌다 (체크 상태는 그대로 반영한다)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  /** 접속 시 한 번 — 숨기기로 한 기간이 지났으면 다시 뜬다 */
  function showIfDue() {
    if (Date.now() >= readHideUntil()) open();
  }

  return { showIfDue, open };
}
