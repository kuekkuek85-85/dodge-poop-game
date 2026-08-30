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
  CLASS_MIN,
  CLASS_MAX,
} from '../public/js/shared/config.js';
import { getDb } from './firestore.js';

const BOARD_MAX_ENTRIES = 60;
const DELETE_CHUNK = 400;
/**
 * 이미 쓴 라운드 토큰을 기억해 두는 기간.
 * 토큰이 유효한 동안(RUN_MAX_AGE_MS)은 반드시 기억하고 있어야 재사용을 알아본다.
 * 개수로 자르면 그 개수만큼 다른 토큰을 흘려보낸 뒤 처음 토큰을 되쓸 수 있다.
 */
const RUN_MEMORY_MS = RUN_MAX_AGE_MS + 60 * 1000;
/**
 * 상한은 "기간 안에 절대 넘칠 수 없는 값"이어야 한다.
 * 저장 간격 제한(5초) 때문에 한 학생이 기억 기간 안에 남길 수 있는 토큰은
 * 최대 RUN_MEMORY_MS / SUBMIT_MIN_INTERVAL_MS 개다. 그보다 넉넉히 잡으면
 * 유효한 토큰이 상한 때문에 밀려나는 일이 생기지 않는다.
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

function mergeEntry(entries, entry) {
  const next = entries.filter((e) => e.key !== entry.key);
  if (entry.score > 0) next.push(entry);
  next.sort(byScoreDesc);
  return next.slice(0, BOARD_MAX_ENTRIES);
}

// ─────────────────────────────────────────────────────────────
// 메모리 저장소 (로컬 개발 전용)
// ─────────────────────────────────────────────────────────────

const mem = { students: new Map(), records: [], boards: new Map(), resets: new Map(), seq: 1 };

const memoryStore = {
  async submitAttempt({ identity, attempt, runId, runIssuedAt, flagged, flagReason, now }) {
    const key = identity.studentKey;
    const prev = mem.students.get(key) || null;

    const consumed = prev ? prev.recentRuns || [] : [];
    if (wasConsumed(consumed, runId, now)) return duplicateResult(prev, attempt);

    // 교사가 지운 시점보다 먼저 시작한 판은 저장하지 않는다
    const clearedAt = Math.max(prev ? prev.clearedAt || 0 : 0, mem.resets.get(identity.classNo) || 0);
    if (startedBeforeClear(runIssuedAt, clearedAt)) return clearedResult();

    if (prev && now - prev.lastSubmitAt < SUBMIT_MIN_INTERVAL_MS) {
      return { rateLimited: true, retryAfterMs: SUBMIT_MIN_INTERVAL_MS - (now - prev.lastSubmitAt) };
    }

    const id = String(mem.seq++);
    mem.records.push({ id, game: GAME_ID, ...identity, ...attempt, flagged, flagReason, createdAt: now });

    const student = prev || {
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
      const board = mem.boards.get(identity.classNo) || [];
      mem.boards.set(identity.classNo, mergeEntry(board, entryFromStudent(student)));
    }
    return { rateLimited: false, isBest, recordId: id, student: { ...student } };
  },

  async getClassBoard(classNo) {
    return { entries: (mem.boards.get(classNo) || []).slice(), updatedAt: Date.now() };
  },

  async listStudentRecords(studentKey, limit) {
    return mem.records
      .filter((r) => r.studentKey === studentKey && isThisGame(r))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
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
      const board = mem.boards.get(student.classNo) || [];
      mem.boards.set(
        student.classNo,
        board.filter((e) => e.key !== studentKey)
      );
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
    const valid = mem.records.filter((r) => r.studentKey === studentKey && isThisGame(r) && !r.flagged);
    const best = pickBest(valid);
    student.bestScore = best ? best.score : 0;
    student.bestSurvivedMs = best ? best.survivedMs : 0;
    student.bestLevel = best ? best.level : 0;
    student.bestAt = best ? best.createdAt : 0;
    student.plays = valid.length;
    const board = mem.boards.get(student.classNo) || [];
    mem.boards.set(student.classNo, mergeEntry(board, entryFromStudent(student)));
  },

  async resetClass(classNo) {
    const now = Date.now();
    mem.resets.set(classNo, now);
    mem.boards.delete(classNo);
    const before = mem.records.length;
    mem.records = mem.records.filter(
      (r) => !(r.classNo === classNo && isThisGame(r) && r.createdAt <= now)
    );
    for (const [key, st] of [...mem.students]) {
      if (st.classNo === classNo && isThisGame(st) && (st.lastSubmitAt || 0) <= now) mem.students.delete(key);
    }
    return { deleted: before - mem.records.length };
  },

  async resetAll() {
    const now = Date.now();
    for (let c = CLASS_MIN; c <= CLASS_MAX; c += 1) mem.resets.set(c, now);
    mem.boards.clear();
    const before = mem.records.length;
    mem.records = mem.records.filter((r) => !(isThisGame(r) && r.createdAt <= now));
    for (const [key, st] of [...mem.students]) {
      if (isThisGame(st) && (st.lastSubmitAt || 0) <= now) mem.students.delete(key);
    }
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
async function markClassReset(db, classNumbers) {
  const now = Date.now();
  const batch = db.batch();
  for (const classNo of classNumbers) {
    batch.set(
      db.collection('boards').doc(boardDocId(classNo)),
      { game: GAME_ID, classNo, entries: [], resetAt: now, updatedAt: now },
      { merge: true }
    );
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

    return db.runTransaction(async (tx) => {
      const studentSnap = await tx.get(studentRef);
      const prev = studentSnap.exists ? studentSnap.data() : null;

      // 같은 라운드 토큰이 다시 오면 저장하지 않는다.
      // 응답이 유실돼 클라이언트가 재전송한 경우와 의도적인 재사용을 함께 막는다.
      const consumed = prev ? prev.recentRuns || [] : [];
      if (wasConsumed(consumed, runId, now)) return duplicateResult(prev, attempt);

      // 순위표 문서는 반 단위 초기화 시각도 함께 들고 있다.
      // 저장 때마다 읽어야 초기화와 저장이 겹치는 순간을 가려낼 수 있다.
      const boardSnap = await tx.get(boardRef);
      const boardData = boardSnap.exists ? boardSnap.data() : null;
      const clearedAt = Math.max(prev ? prev.clearedAt || 0 : 0, boardData ? boardData.resetAt || 0 : 0);
      if (startedBeforeClear(runIssuedAt, clearedAt)) return clearedResult();

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

      const touchBoard = isBest || nameChanged;

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

      if (touchBoard) {
        const entries = boardData ? boardData.entries || [] : [];
        tx.set(
          boardRef,
          {
            game: GAME_ID,
            classNo: identity.classNo,
            entries: mergeEntry(entries, entryFromStudent(student)),
            updatedAt: now,
          },
          { merge: true } // resetAt을 지우지 않는다
        );
      }

      return { rateLimited: false, isBest, recordId: recordRef.id, student };
    });
  },

  async getClassBoard(classNo) {
    const db = await getDb();
    const snap = await db.collection('boards').doc(boardDocId(classNo)).get();
    if (!snap.exists) return { entries: [], updatedAt: 0 };
    const data = snap.data();
    return { entries: data.entries || [], updatedAt: data.updatedAt || 0 };
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
      const boardRef = db.collection('boards').doc(boardDocId(classNo));
      await db.runTransaction(async (tx) => {
        const studentNow = await tx.get(studentRef);
        const board = await tx.get(boardRef);
        if (studentNow.exists) tx.set(studentRef, clearedStudent(studentNow.data(), now), { merge: true });
        if (board.exists) {
          const entries = (board.data().entries || []).filter((e) => e.key !== studentKey);
          tx.set(boardRef, { entries, updatedAt: now }, { merge: true });
        }
      });
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

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists) return;
      const student = snap.data();
      const boardRef = db.collection('boards').doc(boardDocId(student.classNo));

      const recordsSnap = await tx.get(recordsQuery);
      const boardSnap = await tx.get(boardRef);

      const valid = recordsSnap.docs.map((d) => d.data()).filter((r) => isThisGame(r) && !r.flagged);
      const best = pickBest(valid);
      const next = {
        ...student,
        bestScore: best ? best.score : 0,
        bestSurvivedMs: best ? best.survivedMs : 0,
        bestLevel: best ? best.level : 0,
        bestAt: best ? best.createdAt : 0,
        plays: valid.length,
      };

      tx.set(studentRef, next, { merge: true });
      tx.set(
        boardRef,
        {
          game: GAME_ID,
          classNo: student.classNo,
          entries: mergeEntry(boardSnap.exists ? boardSnap.data().entries || [] : [], entryFromStudent(next)),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    });
  },

  async resetClass(classNo) {
    const db = await getDb();
    const now = await markClassReset(db, [classNo]);
    // 다른 게임(4주차 러너 등)이 같은 컬렉션을 쓰게 돼도 이 게임 기록만 지운다.
    // 초기화 시각 이후에 새로 시작한 판은 정상 기록이므로 남긴다.
    const deleted = await deleteMatching(
      db,
      db.collection('records').where('classNo', '==', classNo),
      (d) => isThisGame(d) && d.createdAt <= now
    );
    await deleteMatching(
      db,
      db.collection('students').where('classNo', '==', classNo),
      (d) => isThisGame(d) && (d.lastSubmitAt || 0) <= now
    );
    return { deleted };
  },

  async resetAll() {
    const db = await getDb();
    const classes = Array.from({ length: CLASS_MAX - CLASS_MIN + 1 }, (_, i) => CLASS_MIN + i);
    const now = await markClassReset(db, classes);
    const deleted = await deleteMatching(
      db,
      db.collection('records'),
      (d) => isThisGame(d) && d.createdAt <= now
    );
    await deleteMatching(
      db,
      db.collection('students'),
      (d) => isThisGame(d) && (d.lastSubmitAt || 0) <= now
    );
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
