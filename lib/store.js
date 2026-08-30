// 데이터 접근 계층.
//
// 컬렉션 구성
//   students/{game}:{grade}-{classNo}-{studentNo}
//       학생 1명 = 문서 1개. "1인당 최고 기록 1개"가 구조로 보장된다.
//   records/{auto}
//       모든 회차(비정상으로 판정된 회차 포함). 내 기록 탭 · CSV · 이상 기록 정리용.
//   boards/{game}_class_{classNo}
//       반 순위를 미리 합쳐 둔 문서 1개. 대시보드 갱신 때 문서 하나만 읽으면 되므로
//       28명이 5초마다 새로고침해도 Firestore 읽기량이 거의 늘지 않는다.
//
// DEV_MEMORY_STORE=1 이면 Firestore 없이 프로세스 메모리를 쓴다 (로컬 개발 전용).

import {
  GAME_ID,
  SUBMIT_MIN_INTERVAL_MS,
  RUN_MAX_AGE_MS,
  MAX_SURVIVED_MS,
  CLASS_MIN,
  CLASS_MAX,
} from '../public/js/shared/config.js';
import { getDb } from './firestore.js';

const BOARD_MAX_ENTRIES = 60;
const DELETE_CHUNK = 400;
/**
 * 이미 쓴 라운드 토큰을 기억해 두는 기간.
 *
 * 토큰이 받아들여질 수 있는 동안에는 반드시 기억하고 있어야 재사용을 알아본다.
 * 서버는 `경과 시간 <= 생존 시간 + RUN_MAX_AGE_MS`까지 받아 주므로, 최대 길이의
 * 판이라면 발급 후 (MAX_SURVIVED_MS + RUN_MAX_AGE_MS)까지 유효하다. 기억 기간이
 * 그보다 짧으면 기록이 만료된 뒤 같은 토큰을 다시 쓸 수 있다.
 */
const RUN_MEMORY_MS = MAX_SURVIVED_MS + RUN_MAX_AGE_MS + 60 * 1000;
/**
 * 상한은 "기억 기간 안에 절대 넘칠 수 없는 값"이어야 한다.
 * 저장 간격 제한(5초) 때문에 한 학생이 기억 기간 안에 남길 수 있는 토큰은
 * 최대 RUN_MEMORY_MS / SUBMIT_MIN_INTERVAL_MS 개다. 그보다 넉넉히 잡으면
 * 유효한 토큰이 상한 때문에 밀려나는 일이 생기지 않는다.
 * (현재 값 기준 최대 약 750개 × 50바이트 ≈ 37KB — 문서 상한 1MB에 여유가 있다)
 */
const RUN_MEMORY_MAX = Math.ceil(RUN_MEMORY_MS / SUBMIT_MIN_INTERVAL_MS) + 20;

/** 이 게임의 문서인가 — 4주차 러너 게임과 컬렉션을 공유하게 되면 이 검사가 데이터를 지킨다 */
function isThisGame(data) {
  return !data.game || data.game === GAME_ID;
}

function useMemory() {
  return process.env.DEV_MEMORY_STORE === '1';
}

export function docKey(studentKey) {
  return `${GAME_ID}:${studentKey}`;
}

function boardDocId(classNo) {
  return `${GAME_ID}_class_${classNo}`;
}

function byScoreDesc(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  return a.at - b.at; // 같은 점수는 먼저 달성한 쪽이 위
}

function entryFromStudent(student) {
  return {
    key: student.studentKey,
    classNo: student.classNo,
    studentNo: student.studentNo,
    name: student.name,
    score: student.bestScore,
    level: student.bestLevel,
    survivedMs: student.bestSurvivedMs,
    at: student.bestAt,
  };
}

/** 초기화 전에 시작한 판이라 저장하지 않았을 때의 응답 */
function clearedResult() {
  return { rateLimited: false, cleared: true };
}

/**
 * 이미 처리한 라운드 토큰이 다시 왔을 때의 응답.
 * 아무것도 쓰지 않고, 그 회차가 지금의 최고 기록인지만 알려 준다.
 */
function duplicateResult(prev, attempt) {
  const student = prev || {};
  return {
    rateLimited: false,
    duplicate: true,
    isBest: student.bestScore === attempt.score && student.bestSurvivedMs === attempt.survivedMs,
    student,
  };
}

/** 유효 기간이 지난 토큰 기록을 걷어내고 새 토큰을 더한다 */
function rememberRun(consumed, runId, now) {
  const fresh = consumed.filter((r) => r && now - r.at < RUN_MEMORY_MS);
  if (runId) fresh.push({ id: runId, at: now });
  return fresh.slice(-RUN_MEMORY_MAX);
}

function wasConsumed(consumed, runId, now) {
  return !!runId && consumed.some((r) => r && r.id === runId && now - r.at < RUN_MEMORY_MS);
}

/**
 * 교사가 기록을 지운 시점보다 먼저 시작한 판인가.
 *
 * 라운드 토큰에는 발급 시각이 들어 있으므로, "초기화 버튼을 누르기 전에 시작한 판"을
 * 정확히 가려낼 수 있다. 그런 판은 저장하지 않는다 — 삭제와 저장이 겹쳐 기록이
 * 반쪽만 남는 일을 막는다. 초기화 뒤에 새로 시작한 판은 정상 저장된다.
 */
function startedBeforeClear(runIssuedAt, clearedAt) {
  if (!clearedAt) return false;
  // 토큰이 없는 요청은 시작 시각을 알 수 없다 — 도착 시각으로 판단한다
  const startedAt = Number.isFinite(runIssuedAt) ? runIssuedAt : Infinity;
  return startedAt < clearedAt;
}

/**
 * 반 초기화 이후 처음 저장하는 경우, 학생 문서에 남아 있는 이전 집계는 버린다.
 * 초기화는 순위표를 비운 뒤 학생 문서를 정리하는데, 그 사이에 커밋된 저장은
 * 옛 집계를 그대로 들고 넘어갈 수 있다.
 */
function forgetIfReset(prev, classResetAt) {
  if (!prev) return null;
  if (!classResetAt || classResetAt <= (prev.lastSubmitAt || 0)) return prev;
  return null;
}

/** 지워진 학생 문서의 상태 — 문서는 남기되 기록은 모두 비운다 */
function clearedStudent(student, now) {
  return {
    ...student,
    bestScore: 0,
    bestSurvivedMs: 0,
    bestLevel: 0,
    bestAt: 0,
    plays: 0,
    flaggedCount: 0,
    recentRuns: [],
    clearedAt: now,
  };
}

/** 같은 점수면 먼저 달성한 회차를 최고 기록으로 삼는다 (순위표 동점 규칙과 맞춘다) */
function pickBest(records) {
  return records.reduce((acc, r) => {
    if (!acc) return r;
    if (r.score > acc.score) return r;
    if (r.score === acc.score && r.createdAt < acc.createdAt) return r;
    return acc;
  }, null);
}

/**
 * 순위표 문서의 entries는 **학생 키를 가진 맵**이다.
 *
 * 배열로 두면 한 명을 고치려고 전체를 읽고 다시 써야 하고, 그러려면 트랜잭션이
 * 필요하다. 그러면 한 반의 모든 저장이 문서 하나의 락에서 줄을 선다(28명 기준
 * 저장 절반이 실패). 맵으로 두면 자기 칸만 병합해 쓰면 되므로 서로 부딪히지 않는다.
 * 정렬과 상위 N명 자르기는 읽을 때 메모리에서 한다.
 */
function sortedEntries(entriesMap) {
  return Object.values(entriesMap || {})
    .filter((e) => e && e.score > 0)
    .sort(byScoreDesc)
    .slice(0, BOARD_MAX_ENTRIES);
}

// ─────────────────────────────────────────────────────────────
// 메모리 저장소 (로컬 개발 전용)
// ─────────────────────────────────────────────────────────────

const mem = { students: new Map(), records: [], boards: new Map(), resets: new Map(), seq: 1 };

const memoryStore = {
  async submitAttempt({ identity, attempt, runId, runIssuedAt, flagged, flagReason, now }) {
    const key = identity.studentKey;

    const stored = mem.students.get(key) || null;
    const consumed = stored ? stored.recentRuns || [] : [];
    if (wasConsumed(consumed, runId, now)) return duplicateResult(stored, attempt);

    // 교사가 지운 시점보다 먼저 시작한 판은 저장하지 않는다.
    // 학생 문서의 표시만으로는 부족하다 — 처음 플레이하는 학생은 문서가 없다.
    const classResetAt = mem.resets.get(identity.classNo) || 0;
    const clearedAt = Math.max(stored ? stored.clearedAt || 0 : 0, classResetAt);
    if (startedBeforeClear(runIssuedAt, clearedAt)) return clearedResult();

    const prev = forgetIfReset(stored, classResetAt);

    if (prev && now - prev.lastSubmitAt < SUBMIT_MIN_INTERVAL_MS) {
      return { rateLimited: true, retryAfterMs: SUBMIT_MIN_INTERVAL_MS - (now - prev.lastSubmitAt) };
    }

    const id = String(mem.seq++);
    mem.records.push({ id, game: GAME_ID, ...identity, ...attempt, flagged, flagReason, createdAt: now });

    const student = prev ? { ...prev } : {
      ...identity,
      game: GAME_ID,
      bestScore: 0,
      bestSurvivedMs: 0,
      bestLevel: 0,
      bestAt: 0,
      plays: 0,
      flaggedCount: 0,
      recentRuns: [],
    };
    const nameChanged = !!prev && prev.name !== identity.name && prev.bestScore > 0;
    student.name = identity.name;
    student.lastSubmitAt = now;
    student.recentRuns = rememberRun(consumed, runId, now);
    if (flagged) student.flaggedCount += 1;
    else student.plays += 1;

    const isBest = !flagged && attempt.score > student.bestScore;
    if (isBest) {
      student.bestScore = attempt.score;
      student.bestSurvivedMs = attempt.survivedMs;
      student.bestLevel = attempt.level;
      student.bestAt = now;
    }
    mem.students.set(key, student);

    if (isBest || nameChanged || !prev) {
      const board = mem.boards.get(identity.classNo) || {};
      board[key] = entryFromStudent(student);
      mem.boards.set(identity.classNo, board);
    }
    return { rateLimited: false, isBest, recordId: id, student: { ...student } };
  },

  async getClassBoard(classNo) {
    return { entries: sortedEntries(mem.boards.get(classNo)), updatedAt: Date.now() };
  },

  async listStudentRecords(studentKey, limit) {
    return mem.records
      .filter((r) => r.studentKey === studentKey && isThisGame(r))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  async getStudentSummary(studentKey) {
    const st = mem.students.get(studentKey);
    if (!st || !isThisGame(st)) return null;
    return { bestScore: st.bestScore || 0, plays: st.plays || 0 };
  },

  async listFlagged(classNo) {
    return mem.records
      .filter((r) => r.flagged && r.classNo === classNo && isThisGame(r))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async listClassRecords(classNo) {
    return mem.records
      .filter((r) => isThisGame(r) && (classNo === null || r.classNo === classNo))
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async deleteRecord(id) {
    const idx = mem.records.findIndex((r) => r.id === id && isThisGame(r));
    if (idx < 0) return { deleted: 0 };
    const [removed] = mem.records.splice(idx, 1);
    await this.recomputeStudent(removed.studentKey);
    return { deleted: 1 };
  },

  async deleteStudent(studentKey) {
    const now = Date.now();
    const student = mem.students.get(studentKey);
    // 먼저 "지운 시각"을 남긴다. 그 뒤에 도착하는, 이 시각 이전에 시작한 판은 저장되지 않는다.
    if (student) {
      mem.students.set(studentKey, clearedStudent(student, now));
      const board = mem.boards.get(student.classNo);
      if (board) delete board[studentKey];
    }
    const before = mem.records.length;
    mem.records = mem.records.filter(
      (r) => !(r.studentKey === studentKey && isThisGame(r) && r.createdAt <= now)
    );
    return { deleted: before - mem.records.length };
  },

  async recomputeStudent(studentKey) {
    const student = mem.students.get(studentKey);
    if (!student) return;
    // 지운 시점 이전의 회차는 이미 없어질 것들이다 — 다시 최고 기록으로 세우면 안 된다
    const clearedAt = student.clearedAt || 0;
    const valid = mem.records.filter(
      (r) => r.studentKey === studentKey && isThisGame(r) && !r.flagged && r.createdAt > clearedAt
    );
    const best = pickBest(valid);
    student.bestScore = best ? best.score : 0;
    student.bestSurvivedMs = best ? best.survivedMs : 0;
    student.bestLevel = best ? best.level : 0;
    student.bestAt = best ? best.createdAt : 0;
    student.plays = valid.length;
    const board = mem.boards.get(student.classNo) || {};
    board[studentKey] = entryFromStudent(student);
    mem.boards.set(student.classNo, board);
  },

  async resetClass(classNo) {
    const now = Date.now();
    // 학생 문서마다 "지운 시각"을 남긴다. 문서를 지워 버리면 그 뒤에 도착하는
    // 저장이 표시를 못 보고 되살아난다.
    for (const [key, st] of [...mem.students]) {
      if (st.classNo === classNo && isThisGame(st)) mem.students.set(key, clearedStudent(st, now));
    }
    mem.resets.set(classNo, now);
    mem.boards.delete(classNo);
    const before = mem.records.length;
    mem.records = mem.records.filter(
      (r) => !(r.classNo === classNo && isThisGame(r) && r.createdAt <= now)
    );
    return { deleted: before - mem.records.length };
  },

  /** 학기말 전체 삭제 — 이름까지 지운다(PRD 5.3). 수업 중에 쓰는 기능이 아니다. */
  async resetAll() {
    const before = mem.records.length;
    mem.records = mem.records.filter((r) => !isThisGame(r));
    for (const [key, st] of [...mem.students]) if (isThisGame(st)) mem.students.delete(key);
    mem.boards.clear();
    for (let c = CLASS_MIN; c <= CLASS_MAX; c += 1) mem.resets.set(c, Date.now());
    return { deleted: before - mem.records.length };
  },
};

// ─────────────────────────────────────────────────────────────
// Firestore 저장소
// ─────────────────────────────────────────────────────────────

/**
 * 조건에 맞는 문서를 지운다.
 * 삭제 대상을 메모리에서 한 번 더 걸러내므로(다른 게임의 문서 제외) 커서 방식 대신
 * 한 번에 읽어 온다. 수업 규모(반당 수백 건)에서는 이 편이 단순하고 안전하다.
 */
async function deleteMatching(db, query, matches = isThisGame) {
  const snap = await query.get();
  const targets = snap.docs.filter((d) => matches(d.data()));
  for (let i = 0; i < targets.length; i += DELETE_CHUNK) {
    const batch = db.batch();
    for (const doc of targets.slice(i, i + DELETE_CHUNK)) batch.delete(doc.ref);
    await batch.commit();
  }
  return targets.length;
}

/**
 * 순위표를 비우면서 초기화 시각을 남긴다.
 * 문서를 지우지 않고 남기는 이유는, 저장 쪽이 이 값을 읽어 "초기화 전에 시작한 판"을
 * 가려내야 하기 때문이다.
 */
/**
 * 순위표에 한 학생의 자리를 반영한다.
 *
 * 트랜잭션도, 읽기도 쓰지 않는다. entries가 학생 키를 가진 맵이라 **자기 칸만**
 * 병합해 쓰면 되고, 서로 다른 학생의 쓰기는 부딪히지 않는다. 배열이었을 때는
 * 전체를 읽고 다시 써야 해서 한 반의 저장이 문서 하나의 락에서 줄을 섰다.
 */
async function applyBoardEntry(db, classNo, entry, now) {
  await db.collection('boards').doc(boardDocId(classNo)).set(
    {
      game: GAME_ID,
      classNo,
      entries: { [entry.key]: entry },
      updatedAt: now,
    },
    { merge: true } // 다른 학생의 칸과 resetAt을 건드리지 않는다
  );
}

/** 순위표에서 한 학생의 칸을 지운다 */
async function removeBoardEntry(db, classNo, studentKey, now) {
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection('boards').doc(boardDocId(classNo)).set(
    { entries: { [studentKey]: FieldValue.delete() }, updatedAt: now },
    { merge: true }
  );
}

async function markClassReset(db, classNumbers) {
  const now = Date.now();
  const batch = db.batch();
  for (const classNo of classNumbers) {
    // 병합이 아니라 통째로 덮어쓴다. merge로는 빈 맵이 아무것도 지우지 않는다.
    batch.set(db.collection('boards').doc(boardDocId(classNo)), {
      game: GAME_ID,
      classNo,
      entries: {},
      resetAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return now;
}

const firestoreStore = {
  async submitAttempt({ identity, attempt, runId, runIssuedAt, flagged, flagReason, now }) {
    const db = await getDb();
    const studentRef = db.collection('students').doc(docKey(identity.studentKey));
    const boardRef = db.collection('boards').doc(boardDocId(identity.classNo));
    const recordRef = db.collection('records').doc();

    // 반 단위 초기화 표시는 트랜잭션 **밖에서** 읽는다.
    // 읽기 자체는 락을 잡지 않는다 — 이 문서를 트랜잭션 안에서 만졌을 때
    // 한 반의 저장이 모두 줄을 서서 절반이 실패했다.
    const boardSnap = await boardRef.get();
    const classResetAt = boardSnap.exists ? boardSnap.data().resetAt || 0 : 0;

    const result = await db.runTransaction(async (tx) => {
      const studentSnap = await tx.get(studentRef);
      const stored = studentSnap.exists ? studentSnap.data() : null;

      // 같은 라운드 토큰이 다시 오면 저장하지 않는다.
      // 응답이 유실돼 클라이언트가 재전송한 경우와 의도적인 재사용을 함께 막는다.
      const consumed = stored ? stored.recentRuns || [] : [];
      if (wasConsumed(consumed, runId, now)) return duplicateResult(stored, attempt);

      // 학생 문서의 표시만으로는 부족하다 — 처음 플레이하는 학생은 문서가 없다
      const clearedAt = Math.max(stored ? stored.clearedAt || 0 : 0, classResetAt);
      if (startedBeforeClear(runIssuedAt, clearedAt)) return clearedResult();

      const prev = forgetIfReset(stored, classResetAt);

      if (prev && now - (prev.lastSubmitAt || 0) < SUBMIT_MIN_INTERVAL_MS) {
        return {
          rateLimited: true,
          retryAfterMs: SUBMIT_MIN_INTERVAL_MS - (now - prev.lastSubmitAt),
        };
      }

      const isBest = !flagged && attempt.score > (prev ? prev.bestScore || 0 : 0);
      // 이름을 고쳐 넣었는데 최고 기록은 그대로일 수 있다 — 순위표의 이름도 함께 고친다
      const nameChanged = !!prev && prev.name !== identity.name && (prev.bestScore || 0) > 0;

      const student = {
        ...identity,
        game: GAME_ID,
        name: identity.name,
        bestScore: isBest ? attempt.score : prev ? prev.bestScore || 0 : 0,
        bestSurvivedMs: isBest ? attempt.survivedMs : prev ? prev.bestSurvivedMs || 0 : 0,
        bestLevel: isBest ? attempt.level : prev ? prev.bestLevel || 0 : 0,
        bestAt: isBest ? now : prev ? prev.bestAt || 0 : 0,
        plays: (prev ? prev.plays || 0 : 0) + (flagged ? 0 : 1),
        flaggedCount: (prev ? prev.flaggedCount || 0 : 0) + (flagged ? 1 : 0),
        lastSubmitAt: now,
        recentRuns: rememberRun(consumed, runId, now),
      };

      tx.set(recordRef, {
        game: GAME_ID,
        ...identity,
        ...attempt,
        flagged,
        flagReason: flagReason || null,
        flaggedClass: flagged ? identity.classNo : null,
        createdAt: now,
      });
      tx.set(studentRef, student, { merge: true });

      return {
        rateLimited: false,
        isBest,
        recordId: recordRef.id,
        student,
        // 순위표 반영은 이 트랜잭션 밖에서 따로 한다
        boardEntry: isBest || nameChanged ? entryFromStudent(student) : null,
      };
    });

    if (result.boardEntry) await applyBoardEntry(db, identity.classNo, result.boardEntry, now);
    return result;
  },

  async getClassBoard(classNo) {
    const db = await getDb();
    const snap = await db.collection('boards').doc(boardDocId(classNo)).get();
    if (!snap.exists) return { entries: [], updatedAt: 0 };
    const data = snap.data();
    return { entries: sortedEntries(data.entries), updatedAt: data.updatedAt || 0 };
  },

  async listStudentRecords(studentKey, limit) {
    const db = await getDb();
    const snap = await db.collection('records').where('studentKey', '==', studentKey).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(isThisGame)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /** 최근 목록이 잘려도 "내 최고 점수"는 전체 기준이어야 한다 */
  async getStudentSummary(studentKey) {
    const db = await getDb();
    const snap = await db.collection('students').doc(docKey(studentKey)).get();
    if (!snap.exists) return null;
    const st = snap.data();
    return { bestScore: st.bestScore || 0, plays: st.plays || 0 };
  },

  async listFlagged(classNo) {
    const db = await getDb();
    const snap = await db.collection('records').where('flaggedClass', '==', classNo).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(isThisGame)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async listClassRecords(classNo) {
    const db = await getDb();
    const col = db.collection('records');
    const snap = await (classNo === null ? col.get() : col.where('classNo', '==', classNo).get());
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(isThisGame)
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async deleteRecord(id) {
    const db = await getDb();
    const ref = db.collection('records').doc(id);
    const snap = await ref.get();
    if (!snap.exists || !isThisGame(snap.data())) return { deleted: 0 };
    const { studentKey } = snap.data();
    await ref.delete();
    await this.recomputeStudent(studentKey);
    return { deleted: 1 };
  },

  async deleteStudent(studentKey) {
    const db = await getDb();
    const now = Date.now();
    const studentRef = db.collection('students').doc(docKey(studentKey));

    // 순서가 중요하다. "지운 시각"을 먼저 남겨야, 그 뒤에 도착하는 저장이
    // (이 시각 이전에 시작한 판이라면) 스스로 물러난다. 회차 삭제는 그다음이다.
    const snap = await studentRef.get();
    if (snap.exists) {
      const { classNo } = snap.data();
      await db.runTransaction(async (tx) => {
        const studentNow = await tx.get(studentRef);
        if (studentNow.exists) tx.set(studentRef, clearedStudent(studentNow.data(), now), { merge: true });
      });
      await removeBoardEntry(db, classNo, studentKey, now);
    }

    // 지운 시각 이후에 새로 시작한 판은 정상 기록이므로 남긴다
    const deleted = await deleteMatching(
      db,
      db.collection('records').where('studentKey', '==', studentKey),
      (d) => isThisGame(d) && d.createdAt <= now
    );
    return { deleted };
  },

  async recomputeStudent(studentKey) {
    const db = await getDb();
    const studentRef = db.collection('students').doc(docKey(studentKey));
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) return;

    // 재계산은 저장과 같은 문서를 건드린다. 트랜잭션 밖에서 하면, 교사가 기록을
    // 지우는 사이에 그 학생이 새 기록을 저장했을 때 방금 세운 최고 기록이
    // 옛 값으로 덮여 버린다. 읽기·쓰기를 한 트랜잭션에 묶어 둔다.
    const recordsQuery = db.collection('records').where('studentKey', '==', studentKey);

    const next = await db.runTransaction(async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists) return null;
      const student = snap.data();

      const recordsSnap = await tx.get(recordsQuery);

      // 지운 시점 이전의 회차는 이미 없어질 것들이다 — 다시 최고 기록으로 세우면
      // 비워 둔 순위표에 유령 항목이 되살아난다
      const clearedAt = student.clearedAt || 0;
      const valid = recordsSnap.docs
        .map((d) => d.data())
        .filter((r) => isThisGame(r) && !r.flagged && r.createdAt > clearedAt);
      const best = pickBest(valid);
      const updated = {
        ...student,
        bestScore: best ? best.score : 0,
        bestSurvivedMs: best ? best.survivedMs : 0,
        bestLevel: best ? best.level : 0,
        bestAt: best ? best.createdAt : 0,
        plays: valid.length,
      };

      tx.set(studentRef, updated, { merge: true });
      return updated;
    });

    if (!next) return;
    const now = Date.now();
    if (next.bestScore > 0) await applyBoardEntry(db, next.classNo, entryFromStudent(next), now);
    else await removeBoardEntry(db, next.classNo, studentKey, now);
  },

  async resetClass(classNo) {
    const db = await getDb();
    const now = Date.now();

    // 1) 학생 문서마다 "지운 시각"을 남긴다. 문서를 지워 버리면 그 뒤에 도착하는
    //    저장이 표시를 못 보고 되살아난다. 문서가 흩어져 있어 경합도 없다.
    const students = await db.collection('students').where('classNo', '==', classNo).get();
    const targets = students.docs.filter((d) => isThisGame(d.data()));
    for (let i = 0; i < targets.length; i += DELETE_CHUNK) {
      const batch = db.batch();
      for (const doc of targets.slice(i, i + DELETE_CHUNK)) {
        batch.set(doc.ref, clearedStudent(doc.data(), now), { merge: true });
      }
      await batch.commit();
    }

    // 2) 순위표를 비운다
    await markClassReset(db, [classNo]);

    // 3) 회차 삭제 — 초기화 뒤에 새로 시작한 판은 정상 기록이므로 남긴다
    return {
      deleted: await deleteMatching(
        db,
        db.collection('records').where('classNo', '==', classNo),
        (d) => isThisGame(d) && d.createdAt <= now
      ),
    };
  },

  /** 학기말 전체 삭제 — 이름까지 지운다(PRD 5.3). 수업 중에 쓰는 기능이 아니다. */
  async resetAll() {
    const db = await getDb();
    const deleted = await deleteMatching(db, db.collection('records'));
    await deleteMatching(db, db.collection('students'));
    await deleteMatching(db, db.collection('boards'));
    return { deleted };
  },
};

// ─────────────────────────────────────────────────────────────

function impl() {
  return useMemory() ? memoryStore : firestoreStore;
}

export const store = {
  submitAttempt: (args) => impl().submitAttempt(args),
  getClassBoard: (classNo) => impl().getClassBoard(classNo),
  listStudentRecords: (key, limit) => impl().listStudentRecords(key, limit),
  getStudentSummary: (key) => impl().getStudentSummary(key),
  listFlagged: (classNo) => impl().listFlagged(classNo),
  listClassRecords: (classNo) => impl().listClassRecords(classNo),
  deleteRecord: (id) => impl().deleteRecord(id),
  deleteStudent: (key) => impl().deleteStudent(key),
  resetClass: (classNo) => impl().resetClass(classNo),
  resetAll: () => impl().resetAll(),

  /** 전체 순위: 반 순위 문서들만 읽어서 합친다 (문서 8개 읽기) */
  async getAllBoard(limit) {
    const target = impl();
    const boards = await Promise.all(
      Array.from({ length: CLASS_MAX - CLASS_MIN + 1 }, (_, i) => target.getClassBoard(CLASS_MIN + i))
    );
    const merged = boards.flatMap((b) => b.entries);
    merged.sort(byScoreDesc);
    return { entries: merged.slice(0, limit), updatedAt: Date.now() };
  },
};
