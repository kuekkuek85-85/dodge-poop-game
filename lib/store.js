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
/** 문서가 무한정 커지지 않게 하는 안전장치 (기간 정리가 먼저 걸러 낸다) */
const RUN_MEMORY_MAX = 200;

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

const mem = { students: new Map(), records: [], boards: new Map(), seq: 1 };

const memoryStore = {
  async submitAttempt({ identity, attempt, runId, flagged, flagReason, now }) {
    const key = identity.studentKey;
    const prev = mem.students.get(key) || null;

    const consumed = prev ? prev.recentRuns || [] : [];
    if (wasConsumed(consumed, runId, now)) return duplicateResult(prev, attempt);

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
    const before = mem.records.length;
    mem.records = mem.records.filter((r) => !(r.studentKey === studentKey && isThisGame(r)));
    const student = mem.students.get(studentKey);
    mem.students.delete(studentKey);
    if (student) {
      const board = mem.boards.get(student.classNo) || [];
      mem.boards.set(
        student.classNo,
        board.filter((e) => e.key !== studentKey)
      );
    }
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
    const before = mem.records.length;
    mem.records = mem.records.filter((r) => !(r.classNo === classNo && isThisGame(r)));
    for (const [key, s] of [...mem.students]) {
      if (s.classNo === classNo && isThisGame(s)) mem.students.delete(key);
    }
    mem.boards.delete(classNo);
    return { deleted: before - mem.records.length };
  },

  async resetAll() {
    const before = mem.records.length;
    mem.records = mem.records.filter((r) => !isThisGame(r));
    for (const [key, s] of [...mem.students]) if (isThisGame(s)) mem.students.delete(key);
    mem.boards.clear();
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

const firestoreStore = {
  async submitAttempt({ identity, attempt, runId, flagged, flagReason, now }) {
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
      const boardSnap = touchBoard ? await tx.get(boardRef) : null;

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
        const entries = boardSnap && boardSnap.exists ? boardSnap.data().entries || [] : [];
        tx.set(boardRef, {
          game: GAME_ID,
          classNo: identity.classNo,
          entries: mergeEntry(entries, entryFromStudent(student)),
          updatedAt: now,
        });
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
    const deleted = await deleteMatching(db, db.collection('records').where('studentKey', '==', studentKey));
    const studentRef = db.collection('students').doc(docKey(studentKey));
    const snap = await studentRef.get();
    if (snap.exists) {
      const { classNo } = snap.data();
      await studentRef.delete();
      const boardRef = db.collection('boards').doc(boardDocId(classNo));
      await db.runTransaction(async (tx) => {
        const board = await tx.get(boardRef);
        if (!board.exists) return;
        const entries = (board.data().entries || []).filter((e) => e.key !== studentKey);
        tx.set(boardRef, { entries, updatedAt: Date.now() }, { merge: true });
      });
    }
    return { deleted };
  },

  async recomputeStudent(studentKey) {
    const db = await getDb();
    const studentRef = db.collection('students').doc(docKey(studentKey));
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) return;
    const student = studentSnap.data();

    const snap = await db.collection('records').where('studentKey', '==', studentKey).get();
    const valid = snap.docs.map((d) => d.data()).filter((r) => isThisGame(r) && !r.flagged);
    const best = pickBest(valid);

    const next = {
      ...student,
      bestScore: best ? best.score : 0,
      bestSurvivedMs: best ? best.survivedMs : 0,
      bestLevel: best ? best.level : 0,
      bestAt: best ? best.createdAt : 0,
      plays: valid.length,
    };
    await studentRef.set(next, { merge: true });

    const boardRef = db.collection('boards').doc(boardDocId(student.classNo));
    await db.runTransaction(async (tx) => {
      const board = await tx.get(boardRef);
      const entries = board.exists ? board.data().entries || [] : [];
      tx.set(
        boardRef,
        {
          game: GAME_ID,
          classNo: student.classNo,
          entries: mergeEntry(entries, entryFromStudent(next)),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    });
  },

  async resetClass(classNo) {
    const db = await getDb();
    // 다른 게임(4주차 러너 등)이 같은 컬렉션을 쓰게 돼도 이 게임 기록만 지운다
    const deleted = await deleteMatching(db, db.collection('records').where('classNo', '==', classNo));
    await deleteMatching(db, db.collection('students').where('classNo', '==', classNo));
    await db.collection('boards').doc(boardDocId(classNo)).delete();
    return { deleted };
  },

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
