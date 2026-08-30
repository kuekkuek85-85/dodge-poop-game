// 로컬 개발 서버. Vercel의 정적 파일 + /api 서버리스 함수 구성을 흉내 낸다.
//   DEV_MEMORY_STORE=1 node scripts/dev-server.js
// (Firestore 없이 메모리 저장소로 전체 흐름을 확인할 수 있다)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const API_DIR = path.join(ROOT, 'api');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function notFound(res) {
  res.statusCode = 404;
  res.end('Not found');
}

async function serveApi(req, res, url) {
  const rel = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  if (!/^[a-zA-Z0-9/_-]+$/.test(rel)) return notFound(res);
  const file = path.join(API_DIR, `${rel}.js`);
  if (!file.startsWith(API_DIR) || !existsSync(file)) return notFound(res);

  const mod = await import(pathToFileURL(file).href);
  req.query = Object.fromEntries(url.searchParams.entries());
  try {
    await mod.default(req, res);
  } catch (err) {
    console.error(`[api] ${url.pathname}`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, code: 'SERVER_ERROR', message: String(err.message || err) }));
    }
  }
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  else if (!path.extname(rel)) rel = `${rel}.html`; // cleanUrls: /teacher → teacher.html

  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) return notFound(res);

  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await serveApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Server error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`dev server  http://localhost:${PORT}`);
  console.log(`저장소      ${process.env.DEV_MEMORY_STORE === '1' ? '메모리(개발용)' : 'Firestore'}`);
});
