// 기록 대시보드 — 우리 반 / 전체 / 내 기록.
// 5초마다 자동 갱신하되, 화면을 벗어나거나 탭이 가려지면 즉시 멈춘다(게임 프레임 보호).

import { api } from '../api.js';
import { DASHBOARD_POLL_MS, MY_RECORDS_LIMIT } from '../shared/config.js';
import { loadRecent, loadReveal, saveReveal } from '../storage.js';

export function createDashboardScreen(app) {
  const body = document.getElementById('boardBody');
  const updated = document.getElementById('boardUpdated');
  const toggleReveal = document.getElementById('toggleReveal');
  const tabs = [...document.querySelectorAll('.tab')];

  let tab = 'class';
  let timer = 0;
  let active = false;
  let requestSeq = 0;

  toggleReveal.checked = loadReveal();

  for (const button of tabs) {
    button.addEventListener('click', () => {
      tab = button.dataset.tab;
      for (const other of tabs) other.classList.toggle('is-active', other === button);
      body.replaceChildren(message('불러오는 중…'));
      refresh();
    });
  }

  toggleReveal.addEventListener('change', () => {
    saveReveal(toggleReveal.checked);
    refresh();
  });

  document.getElementById('btnRefresh').addEventListener('click', refresh);
  document.getElementById('btnToGame').addEventListener('click', () => app.show('play'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else if (active) startPolling();
  });

  function message(text) {
    const p = document.createElement('p');
    p.className = 'board-empty';
    p.textContent = text;
    return p;
  }

  function rankItem({ rank, classNo, name, score, sub, me, flagged }) {
    const li = document.createElement('li');
    li.className = 'rank-item';
    if (me) li.classList.add('is-me');
    if (flagged) li.classList.add('is-flagged');

    const no = document.createElement('span');
    no.className = 'rank-no';
    no.textContent = rank;

    const label = document.createElement('span');
    label.className = 'rank-name';
    if (classNo) {
      const tag = document.createElement('span');
      tag.className = 'rank-class';
      tag.textContent = `${classNo}반`;
      label.append(tag);
    }
    label.append(document.createTextNode(name));
    if (flagged) {
      const flag = document.createElement('span');
      flag.className = 'flag-tag';
      flag.textContent = '확인 필요';
      label.append(flag);
    }

    const value = document.createElement('span');
    value.className = 'rank-score';
    value.textContent = String(score);
    if (sub) {
      const small = document.createElement('span');
      small.className = 'rank-sub';
      small.textContent = sub;
      value.append(small);
    }

    li.append(no, label, value);
    return li;
  }

  function renderRows(rows, { withClass }) {
    if (!rows.length) {
      body.replaceChildren(message('아직 기록이 없습니다. 먼저 한 판 해 보세요!'));
      return;
    }
    const list = document.createElement('ul');
    list.className = 'rank-list';
    for (const row of rows) {
      list.append(
        rankItem({
          rank: row.rank,
          classNo: withClass ? row.classNo : null,
          name: row.name,
          score: row.score,
          sub: `LV ${row.level} · ${(row.survivedMs / 1000).toFixed(1)}초`,
          me: row.me,
        })
      );
    }
    body.replaceChildren(list);
  }

  /**
   * @param stats 서버가 준 전체 기준 집계. 목록은 최근 몇 회만 오므로,
   *              20회를 넘겨 플레이한 학생은 목록에서 최고 기록을 구하면 안 된다.
   */
  function renderMine(records, stats) {
    if (!records.length) {
      body.replaceChildren(message('아직 기록이 없습니다.'));
      return;
    }
    const windowBest = records.reduce((acc, r) => (!r.flagged && r.score > acc ? r.score : acc), 0);
    const best = Math.max(stats?.bestScore || 0, windowBest);
    const plays = Math.max(stats?.plays || 0, records.length);

    const summary = document.createElement('div');
    summary.className = 'my-summary';
    summary.append(document.createTextNode('내 최고 점수 '));
    const strong = document.createElement('b');
    strong.textContent = String(best);
    summary.append(strong, document.createTextNode(`  ·  총 ${plays}회 플레이`));

    const list = document.createElement('ul');
    list.className = 'rank-list';
    records.forEach((r, index) => {
      list.append(
        rankItem({
          // 목록이 잘렸으면 전체 플레이 수에서 거꾸로 센다.
          // 목록 길이로 세면 45번 한 학생에게 "20회"라고 적히게 된다.
          rank: `${plays - index}회`,
          classNo: null,
          name: formatTime(r.createdAt),
          score: r.score,
          sub: `LV ${r.level} · ${(r.survivedMs / 1000).toFixed(1)}초`,
          me: !r.flagged && r.score === best,
          flagged: r.flagged,
        })
      );
    });

    body.replaceChildren(summary, list);
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function setUpdatedNow() {
    updated.textContent = `${formatTime(Date.now())} 기준`;
  }

  async function refresh() {
    const my = ++requestSeq;
    try {
      if (tab === 'mine') {
        // 로컬 기록을 먼저 보여 주고 서버 응답으로 교체한다
        const cachedRows = loadRecent(app.studentKey);
        if (cachedRows.length) renderMine(cachedRows.slice(0, MY_RECORDS_LIMIT), null);
        const res = await api.myRecords(app.studentKey);
        if (my !== requestSeq) return;
        renderMine(res.records, res.summary);
      } else {
        const res = await api.leaderboard({
          scope: tab,
          classNo: tab === 'class' ? app.profile.classNo : undefined,
          me: app.studentKey,
          reveal: toggleReveal.checked,
        });
        if (my !== requestSeq) return;
        renderRows(res.rows, { withClass: tab === 'all' });
      }
      setUpdatedNow();
    } catch {
      if (my !== requestSeq) return;
      if (!body.querySelector('.rank-list')) {
        body.replaceChildren(message('기록을 불러오지 못했습니다. 새로고침을 눌러 보세요.'));
      }
      updated.textContent = '갱신 실패 — 이전 기록 표시 중';
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

  function onShow() {
    active = true;
    body.replaceChildren(message('불러오는 중…'));
    refresh();
    startPolling();
  }

  function onHide() {
    active = false;
    stopPolling();
  }

  return { onShow, onHide };
}
