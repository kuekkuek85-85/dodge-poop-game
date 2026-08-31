// 난이도 실험실.
//
// 학생이 난이도 숫자를 바꾸면, 게임과 똑같은 규칙(state.js)으로 자동 플레이를
// 여러 판 돌려 생존 시간 분포를 보여 준다. 값을 바꾸는 것과 결과를 재는 것이
// 한 화면에 있어야 "바꿨더니 이렇게 되더라"가 눈에 남는다.
//
// 여기서는 아무것도 저장하지 않는다 — 순수한 시뮬레이션이다.

import * as D from './shared/difficulty.js';
import { createGame, update } from './game/state.js';
import { autoplay } from './game/autoplay.js';

/** 한 판이 이보다 길어지면 끊는다 (수업 시간에 끝나야 한다) */
const MAX_RUN_MS = 3 * 60 * 1000;
/** 목표 구간 */
const TARGET_MIN = 20;
const TARGET_MAX = 60;

const CONTROLS = [
  { key: 'LEVEL_UP_MS', label: '레벨업 간격', unit: '초', min: 2000, max: 15000, step: 500, scale: 1000 },
  { key: 'FALL_SPEED_BASE', label: '낙하 속도 (레벨 1)', unit: 'px/초', min: 100, max: 400, step: 10 },
  { key: 'FALL_SPEED_STEP', label: '레벨당 속도 증가', unit: 'px/초', min: 0, max: 80, step: 2 },
  { key: 'SPAWN_MS_BASE', label: '생성 간격 (레벨 1)', unit: 'ms', min: 300, max: 1500, step: 20 },
  { key: 'SPAWN_MS_STEP', label: '레벨당 간격 감소', unit: 'ms', min: 0, max: 200, step: 5 },
  { key: 'LIVES_START', label: '시작 목숨', unit: '개', min: 1, max: 3, step: 1 },
  { key: 'ITEM_SPAWN_MS', label: '아이템 생성 간격', unit: '초', min: 1000, max: 15000, step: 250, scale: 1000 },
];

// 두 프리셋은 시작점이 같고 딱 하나만 다르다. 그래야 무엇 때문에 달라졌는지
// 말할 수 있다 — 한 번에 둘을 바꾸면 아무것도 알 수 없다.
const PRESETS = {
  default: {},
  // 생성 간격은 고정하고 속도만 가파르게 올린다.
  // 빨라지는데 화면 위 개수는 오히려 줄어든다 (낙하 시간이 짧아지므로).
  speed: { FALL_SPEED_BASE: 200, FALL_SPEED_STEP: 60, SPAWN_MS_BASE: 880, SPAWN_MS_STEP: 0 },
  // 속도는 고정하고 생성 간격만 좁힌다. 속도가 그대로인데 훨씬 어려워진다.
  count: { FALL_SPEED_BASE: 200, FALL_SPEED_STEP: 0, SPAWN_MS_BASE: 880, SPAWN_MS_STEP: 60 },
};

const cfg = { ...D.DEFAULTS };

/* ── 시뮬레이션 ───────────────────────────────────────────── */

function playOnce(settings, seed) {
  // 실제 게임은 배치가 씨앗 하나로 고정돼 있다. 여기서는 "이 난이도 설정이
  // 얼마나 어려운가"를 보려는 것이므로, 씨앗을 바꿔 가며 여러 배치를 겪게 한다.
  const game = createGame({ ...settings, STAGE_SEED: seed });
  while (!game.over && game.elapsedMs < MAX_RUN_MS) {
    update(game, D.TICK_MS, autoplay(game));
  }
  return game.elapsedMs / 1000;
}

/**
 * 판을 나눠서 돌린다. 한 번에 다 돌리면 화면이 몇 초씩 멈춰
 * 태블릿에서 "고장난 줄" 알게 된다.
 */
function runExperiment(settings, runs, onProgress) {
  return new Promise((resolve) => {
    const secs = [];
    let i = 0;
    const step = () => {
      const end = Math.min(runs, i + 10);
      for (; i < end; i += 1) secs.push(playOnce(settings, 1000 + i * 7919));
      onProgress(i / runs);
      if (i < runs) setTimeout(step, 0);
      else resolve(secs.sort((a, b) => a - b));
    };
    step();
  });
}

/* ── 통계 ─────────────────────────────────────────────────── */

const quantile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];

function summarize(secs) {
  const mean = secs.reduce((s, v) => s + v, 0) / secs.length;
  const inTarget = secs.filter((s) => s >= TARGET_MIN && s <= TARGET_MAX).length;
  return {
    median: quantile(secs, 0.5),
    mean,
    min: secs[0],
    max: secs[secs.length - 1],
    inTargetPct: Math.round((inTarget / secs.length) * 100),
    shortPct: Math.round((secs.filter((s) => s < TARGET_MIN).length / secs.length) * 100),
    longPct: Math.round((secs.filter((s) => s > TARGET_MAX).length / secs.length) * 100),
  };
}

/* ── 화면 ─────────────────────────────────────────────────── */

const elControls = document.getElementById('controls');
const elChart = document.getElementById('chart');
const elChartNote = document.getElementById('chartNote');
const elStats = document.getElementById('stats');
const elVerdict = document.getElementById('verdict');
const elResult = document.getElementById('resultPanel');
const elProgress = document.getElementById('progress');
const elProgressBar = document.getElementById('progressBar');
const elBtnRun = document.getElementById('btnRun');
const elTableBody = document.querySelector('#levelTable tbody');

const shown = (key, value) => {
  const c = CONTROLS.find((x) => x.key === key);
  return c.scale ? (value / c.scale).toFixed(1) : String(value);
};

function buildControls() {
  for (const c of CONTROLS) {
    const row = document.createElement('label');
    row.className = 'control';
    row.innerHTML = `
      <span class="control-label">${c.label}</span>
      <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${cfg[c.key]}"
             data-key="${c.key}" />
      <output data-out="${c.key}">${shown(c.key, cfg[c.key])}${c.unit}</output>`;
    elControls.append(row);
  }

  elControls.addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    cfg[key] = Number(e.target.value);
    const c = CONTROLS.find((x) => x.key === key);
    elControls.querySelector(`[data-out="${key}"]`).textContent = `${shown(key, cfg[key])}${c.unit}`;
    renderLevelTable();
    markStale();
  });
}

function applyPreset(name) {
  Object.assign(cfg, D.DEFAULTS, PRESETS[name] || {});
  for (const c of CONTROLS) {
    elControls.querySelector(`[data-key="${c.key}"]`).value = String(cfg[c.key]);
    elControls.querySelector(`[data-out="${c.key}"]`).textContent = `${shown(c.key, cfg[c.key])}${c.unit}`;
  }
  renderLevelTable();
  markStale();
}

/** 값을 바꾸면 이전 결과는 더 이상 이 설정의 결과가 아니다 */
function markStale() {
  elResult.classList.add('stale');
}

function renderLevelTable() {
  const rows = D.difficultyTable(cfg);
  const maxCount = Math.max(...rows.map((r) => r.onScreen));
  elTableBody.innerHTML = rows
    .map((r) => {
      const w = Math.round((r.onScreen / maxCount) * 100);
      return `<tr>
        <td>${r.level}</td>
        <td>${r.fromSec}초</td>
        <td>${Math.round(r.fallSpeed)}px/s</td>
        <td>${Math.round(r.spawnMs)}ms</td>
        <td class="count-cell">
          <span class="count-bar" style="width:${w}%"></span>
          <span class="count-num">${r.onScreen.toFixed(1)}개</span>
        </td>
      </tr>`;
    })
    .join('');
}

function renderChart(secs) {
  const BUCKET = 10;
  const BUCKETS = 10; // 0~10, 10~20, ... 90초 이상
  const counts = new Array(BUCKETS).fill(0);
  for (const s of secs) counts[Math.min(BUCKETS - 1, Math.floor(s / BUCKET))] += 1;
  const max = Math.max(...counts, 1);

  elChart.innerHTML = counts
    .map((n, i) => {
      const from = i * BUCKET;
      const inTarget = from >= TARGET_MIN && from < TARGET_MAX;
      const label = i === BUCKETS - 1 ? '90+' : `${from}`;
      const pct = Math.round((n / secs.length) * 100);
      return `<div class="bar-col${inTarget ? ' in-target' : ''}">
        <span class="bar-val">${n ? `${pct}%` : ''}</span>
        <span class="bar" style="height:${(n / max) * 100}%"></span>
        <span class="bar-label">${label}</span>
      </div>`;
    })
    .join('');

  elChartNote.textContent = '가로축 = 버틴 시간(초). 파란 칸이 목표 구간(20~60초)이다.';
}

function renderStats(s) {
  const gap = Math.abs(s.mean - s.median);
  elStats.innerHTML = `
    <div class="stat"><b>${s.median.toFixed(1)}초</b><span>중앙값</span></div>
    <div class="stat"><b>${s.mean.toFixed(1)}초</b><span>평균</span></div>
    <div class="stat"><b>${s.min.toFixed(1)}초</b><span>가장 짧은 판</span></div>
    <div class="stat"><b>${s.max.toFixed(1)}초</b><span>가장 긴 판</span></div>
    <div class="stat wide ${s.inTargetPct >= 70 ? 'good' : ''}">
      <b>${s.inTargetPct}%</b><span>20~60초에 끝난 판</span>
    </div>`;

  const lines = [];
  if (s.inTargetPct >= 70) lines.push('👍 목표 달성! 대부분의 판이 20~60초에 끝난다.');
  else if (s.shortPct > s.longPct) lines.push(`너무 어렵다 — ${s.shortPct}%가 20초도 못 버틴다.`);
  else lines.push(`너무 쉽다 — ${s.longPct}%가 60초를 넘긴다.`);

  // 평균과 중앙값이 벌어지면 분포가 한 덩어리가 아니라는 신호다
  if (gap >= 8) {
    lines.push(
      `평균(${s.mean.toFixed(1)}초)과 중앙값(${s.median.toFixed(1)}초)이 ${gap.toFixed(1)}초나 차이 난다. ` +
        '그래프를 보자 — 봉우리가 두 개는 아닌가? 이럴 때는 평균 하나로 "보통 몇 초"를 말할 수 없다.'
    );
  }
  elVerdict.innerHTML = lines.map((t) => `<span>${t}</span>`).join('');
}

async function run() {
  elBtnRun.disabled = true;
  elBtnRun.textContent = '로봇이 노는 중…';
  elProgress.hidden = false;
  elProgressBar.style.width = '0%';

  const runs = Number(document.getElementById('runCount').value);
  const secs = await runExperiment({ ...cfg }, runs, (p) => {
    elProgressBar.style.width = `${Math.round(p * 100)}%`;
  });

  renderStats(summarize(secs));
  renderChart(secs);
  elResult.hidden = false;
  elResult.classList.remove('stale');
  elProgress.hidden = true;
  elBtnRun.disabled = false;
  elBtnRun.textContent = '실험 시작';
  elResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

buildControls();
renderLevelTable();
elBtnRun.addEventListener('click', run);
document.querySelectorAll('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => applyPreset(b.dataset.preset))
);
