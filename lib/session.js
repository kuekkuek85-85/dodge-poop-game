// 교사 모드 세션. 비밀 코드를 맞히면 서명 쿠키를 발급하고,
// 이후 교사 API는 쿠키만 확인한다. 쿠키는 HttpOnly라 JS로 읽을 수 없다.

import { hmac, safeEqual } from './secret.js';

const COOKIE_NAME = 't_sess';
const TTL_MS = 8 * 60 * 60 * 1000; // 수업 하루치

export function teacherCode() {
  return process.env.TEACHER_CODE || '123456';
}

function sign(exp) {
  return hmac('SESSION_SECRET', `teacher.${exp}`);
}

export function buildSessionCookie(now = Date.now()) {
  const exp = now + TTL_MS;
  const value = `${exp}.${sign(exp)}`;
  const secure = process.env.VERCEL ? ' Secure;' : '';
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${Math.floor(TTL_MS / 1000)}; HttpOnly; SameSite=Lax;${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax;`;
}

function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function hasTeacherSession(req, now = Date.now()) {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 0) return false;
  const exp = Number(raw.slice(0, dot));
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < now) return false;
  return safeEqual(sig, sign(exp));
}
