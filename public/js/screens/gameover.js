// 결과 화면 — 이번 점수 / 내 최고 / 우리 반 순위.
// 기록은 버튼 없이 자동 저장한다(PRD 4.2).

import { difficultyTable } from '../shared/difficulty.js';
import { loadBest } from '../storage.js';

const SAVE_MESSAGE = {
  saving: '기록 저장 중…',
  saved: '기록이 저장되었습니다.',
  queued: '연결이 불안정해 잠시 후 다시 저장합니다.',
  rejected: '기록이 정상 범위를 벗어나 순위에 반영되지 않았습니다.',
  cleared: '선생님이 기록을 초기화해서 이번 판은 저장되지 않았습니다.',
  failed: '연결 문제로 이번 기록을 저장하지 못했습니다.',
};

export function createGameOverScreen(app) {
  const elBadge = document.getElementById('bestBadge');
  const elScore = document.getElementById('resultScore');
  const elTime = document.getElementById('resultTime');
  const elBest = document.getElementById('resultBest');
  const elRank = document.getElementById('resultRank');
  const elSaveState = document.getElementById('saveState');
  const tableBody = document.querySelector('#difficultyTable tbody');

  let sequence = 0;

  document.getElementById('btnRetry').addEventListener('click', () => app.show('play'));
  document.getElementById('btnToDashboard').addEventListener('click', () => app.show('dashboard'));
  document.getElementById('btnChangeUser').addEventListener('click', () => app.show('entry'));

  function renderDifficulty(reachedLevel) {
    tableBody.replaceChildren();
    for (const row of difficultyTable()) {
      const tr = document.createElement('tr');
      if (row.level <= reachedLevel) tr.className = 'is-reached';
      const cells = [
        `LV ${row.level}`,
        `${row.fromSec}초`,
        `${Math.round(row.fallSpeed)}px/s`,
        `${Math.round(row.spawnMs)}ms`,
        `×${row.multiplier.toFixed(2)}`,
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      tableBody.append(tr);
    }
  }

  function setSaveState(state) {
    elSaveState.textContent = SAVE_MESSAGE[state] || '';
    elSaveState.classList.toggle('is-error', state === 'rejected' || state === 'failed' || state === 'cleared');
  }

  async function onShow(attempt) {
    const my = sequence + 1;
    sequence = my;

    elScore.textContent = String(attempt.score);
    elTime.textContent = `${(attempt.survivedMs / 1000).toFixed(1)}초`;
    elRank.textContent = '-';
    elBadge.hidden = true;
    renderDifficulty(attempt.level);

    // 저장(app.saveAttempt)이 로컬 최고 기록을 갱신하므로 그 전에 읽어 둔다
    const prevBest = loadBest(app.studentKey);
    const localBest = Math.max(prevBest, attempt.score);
    elBest.textContent = String(localBest);
    elBadge.hidden = !(attempt.score > prevBest && attempt.score > 0);

    setSaveState('saving');
    const result = await app.saveAttempt(attempt);
    if (my !== sequence) return; // 이미 다음 판으로 넘어갔다

    setSaveState(result.state);
    if (result.best) elBest.textContent = String(Math.max(result.best.score, localBest));
    if (result.classRank) elRank.textContent = `${result.classRank}등 / ${result.classCount}명`;
    // 저장이 성공했다면 서버 판정이 최종이다.
    // (기기를 바꾸거나 저장소가 비워졌을 때 로컬 판단이 틀릴 수 있다)
    if (result.state === 'saved') elBadge.hidden = !result.isBest;
  }

  return { onShow };
}
