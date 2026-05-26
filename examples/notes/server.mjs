#!/usr/bin/env node
// Notes app server. Plain http, SQLite, HMAC-signed cookies for auth,
// SSR via the framework's renderToString. Zero npm deps beyond what
// the framework already vendors.
//
//   node framework/examples/notes/server.mjs
//
// Routes:
//   GET  /                  → SSR'd page (logged-in or login form)
//   GET  /favicon.ico       → 204
//   GET  /src/*, /vendor/*, /examples/*, /framework/* → static passthrough under framework/
//   POST /api/signup        → { username, password } → 200 + session cookie
//   POST /api/login         → { username, password } → 200 + session cookie
//   POST /api/logout        → clears the cookie
//   GET  /api/me            → { id, username } | 401
//   GET  /api/notes         → [{ id, title, body, updatedAt }]
//   POST /api/notes         → { title, body } → created note
//   PUT  /api/notes/:id     → { title?, body? } → updated note
//   DELETE /api/notes/:id   → 204

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

import { setupDOM, renderToString } from '../../src/ssr.js';

// ---- Paths --------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// ---- DB -----------------------------------------------------------------
const db = new DatabaseSync(resolve(here, 'notes.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    pw_hash BLOB NOT NULL,
    pw_salt BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ---- Auth ---------------------------------------------------------------
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-do-not-use-in-prod';
const sign = (s) => createHmac('sha256', SESSION_SECRET).update(s).digest('base64url');
const makeCookie = (userId) => `${userId}.${sign(String(userId))}`;
const verifyCookie = (cookie) => {
  if (!cookie) return null;
  const [id, sig] = cookie.split('.');
  if (!id || !sig) return null;
  const expected = sign(id);
  // timing-safe compare
  if (expected.length !== sig.length) return null;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? Number(id) : null;
  } catch { return null; }
};
const hashPassword = (password, salt = randomBytes(16)) =>
  ({ hash: pbkdf2Sync(password, salt, 100_000, 32, 'sha256'), salt });
const verifyPassword = (password, salt, expected) => {
  const { hash } = hashPassword(password, salt);
  return hash.length === expected.length && timingSafeEqual(hash, expected);
};

const sessionFrom = (req) => {
  const cookieHeader = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)nsess=([^;]+)/.exec(cookieHeader);
  if (!match) return null;
  const userId = verifyCookie(decodeURIComponent(match[1]));
  if (!userId) return null;
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  return row ? { id: row.id, username: row.username } : null;
};

// ---- Helpers ------------------------------------------------------------
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readJson = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    try { resolve(data ? JSON.parse(data) : {}); }
    catch (e) { reject(e); }
  });
  req.on('error', reject);
});
const setCookie = (res, value, opts = {}) => {
  const parts = [`nsess=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expired) parts.push('Max-Age=0');
  res.setHeader('Set-Cookie', parts.join('; '));
};

// ---- SSR ----------------------------------------------------------------
await setupDOM();
// Define the components in the server's DOM environment.
await import('./app.js');

const renderPage = (initialState) => {
  // Mount <x-notes-app> with the initial state as a data attribute.
  // The client picks it up from the same attribute on hydration.
  const json = JSON.stringify(initialState).replace(/</g, '\\u003c');
  const body = renderToString('x-notes-app', { initial: json });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Notes · mohsal-framework</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f7f7f8; color: #222; }
    main { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }
    h1 { margin: 0 0 1rem; font-size: 1.5rem; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .toolbar .who { color: #666; font-size: 0.9rem; }
    button { font: inherit; padding: 0.45rem 0.9rem; border-radius: 4px; border: 1px solid #ccc; background: white; cursor: pointer; }
    button.primary { background: #06f; color: white; border-color: #06f; }
    button:hover { background: #f4f4f4; } button.primary:hover { background: #05c; }
    input, textarea { font: inherit; padding: 0.5rem 0.7rem; border-radius: 4px; border: 1px solid #ccc; box-sizing: border-box; }
    input:focus, textarea:focus { outline: 2px solid #06f; outline-offset: -1px; }
    .form { background: white; padding: 1.25rem; border-radius: 8px; max-width: 360px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .form h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
    .form label { display: block; margin-bottom: 0.6rem; }
    .form label span { display: block; font-size: 0.85rem; color: #555; margin-bottom: 0.2rem; }
    .form input { width: 100%; }
    .form .err { color: #c00; font-size: 0.85rem; margin-top: 0.3rem; min-height: 1.1em; }
    .form .actions { display: flex; gap: 0.4rem; margin-top: 0.4rem; }
    .form .switch { font-size: 0.85rem; color: #666; margin-top: 0.6rem; }
    .form .switch a { color: #06f; cursor: pointer; }
    .notes-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 1rem; }
    .notes-list { background: white; padding: 0.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .note-item { padding: 0.6rem; border-radius: 4px; cursor: pointer; border-bottom: 1px solid #eee; }
    .note-item:last-child { border-bottom: none; }
    .note-item:hover { background: #f7f7f8; }
    .note-item.active { background: #eaf2ff; }
    .note-item h3 { margin: 0 0 0.15rem; font-size: 0.95rem; }
    .note-item .preview { color: #666; font-size: 0.8rem; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; max-height: 2.5em; }
    .empty { color: #888; padding: 1rem; font-size: 0.9rem; }
    .editor { background: white; padding: 1rem 1.25rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); display: flex; flex-direction: column; gap: 0.5rem; }
    .editor input.title { font-size: 1.1rem; font-weight: 600; padding: 0.5rem 0.5rem; border: 1px solid transparent; }
    .editor input.title:focus { border-color: #ccc; }
    .editor .editor-actions { display: flex; justify-content: space-between; }
    .editor .status { color: #888; font-size: 0.8rem; }
    x-notes-app { display: block; }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
  <script type="module" src="/examples/notes/app.js"></script>
</body>
</html>`;
};

// ---- HTTP server --------------------------------------------------------
const PORT = Number(process.env.PORT) || 8081;

const server = createServer(async (req, res) => {
  const { url, method } = req;
  try {
    if (url === '/' && method === 'GET') {
      const session = sessionFrom(req);
      const initial = session
        ? {
            session,
            notes: db.prepare(
              'SELECT id, title, body, updated_at as updatedAt FROM notes WHERE user_id = ? ORDER BY updated_at DESC'
            ).all(session.id),
          }
        : { session: null, notes: [] };
      const html = renderPage(initial);
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(html);
    }

    if (url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    // Static file passthrough. repoRoot is the framework/ directory; allow
    // any path under /src/, /vendor/, /examples/, or a legacy /framework/ prefix
    // (stripped so it resolves under repoRoot).
    const isStatic = method === 'GET' && (
      url.startsWith('/framework/') ||
      url.startsWith('/examples/') ||
      url.startsWith('/src/') ||
      url.startsWith('/vendor/')
    );
    if (isStatic) {
      let safe = url.split('?')[0];
      if (safe.startsWith('/framework/')) safe = safe.slice('/framework'.length);
      const filePath = join(repoRoot, safe);
      if (existsSync(filePath)) {
        const ext = extname(filePath);
        const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.map': 'application/json' };
        res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' });
        return res.end(readFileSync(filePath));
      }
    }

    // ---- API ---
    if (url === '/api/signup' && method === 'POST') {
      const { username, password } = await readJson(req);
      if (!username || !password) return json(res, 400, { error: 'username + password required' });
      if (password.length < 6) return json(res, 400, { error: 'password must be at least 6 characters' });
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) return json(res, 409, { error: 'username taken' });
      const { hash, salt } = hashPassword(password);
      const info = db.prepare(
        'INSERT INTO users (username, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?)'
      ).run(username, hash, salt, Date.now());
      const userId = info.lastInsertRowid;
      setCookie(res, makeCookie(userId), { maxAge: 60 * 60 * 24 * 14 });
      return json(res, 200, { id: userId, username });
    }

    if (url === '/api/login' && method === 'POST') {
      const { username, password } = await readJson(req);
      if (!username || !password) return json(res, 400, { error: 'username + password required' });
      const row = db.prepare('SELECT id, username, pw_hash, pw_salt FROM users WHERE username = ?').get(username);
      if (!row || !verifyPassword(password, row.pw_salt, row.pw_hash)) {
        return json(res, 401, { error: 'invalid credentials' });
      }
      setCookie(res, makeCookie(row.id), { maxAge: 60 * 60 * 24 * 14 });
      return json(res, 200, { id: row.id, username: row.username });
    }

    if (url === '/api/logout' && method === 'POST') {
      setCookie(res, '', { expired: true });
      return json(res, 200, { ok: true });
    }

    if (url === '/api/me' && method === 'GET') {
      const session = sessionFrom(req);
      if (!session) return json(res, 401, { error: 'unauthenticated' });
      return json(res, 200, session);
    }

    if (url === '/api/notes' && method === 'GET') {
      const session = sessionFrom(req);
      if (!session) return json(res, 401, { error: 'unauthenticated' });
      const notes = db.prepare(
        'SELECT id, title, body, updated_at as updatedAt FROM notes WHERE user_id = ? ORDER BY updated_at DESC'
      ).all(session.id);
      return json(res, 200, notes);
    }

    if (url === '/api/notes' && method === 'POST') {
      const session = sessionFrom(req);
      if (!session) return json(res, 401, { error: 'unauthenticated' });
      const { title = '', body = '' } = await readJson(req);
      const now = Date.now();
      const info = db.prepare(
        'INSERT INTO notes (user_id, title, body, updated_at) VALUES (?, ?, ?, ?)'
      ).run(session.id, String(title), String(body), now);
      return json(res, 200, { id: info.lastInsertRowid, title, body, updatedAt: now });
    }

    const noteIdMatch = /^\/api\/notes\/(\d+)$/.exec(url ?? '');
    if (noteIdMatch && (method === 'PUT' || method === 'DELETE')) {
      const session = sessionFrom(req);
      if (!session) return json(res, 401, { error: 'unauthenticated' });
      const id = Number(noteIdMatch[1]);
      const note = db.prepare('SELECT id, user_id FROM notes WHERE id = ?').get(id);
      if (!note || note.user_id !== session.id) return json(res, 404, { error: 'note not found' });
      if (method === 'DELETE') {
        db.prepare('DELETE FROM notes WHERE id = ?').run(id);
        res.writeHead(204).end();
        return;
      }
      const { title, body } = await readJson(req);
      const now = Date.now();
      db.prepare(
        'UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body), updated_at = ? WHERE id = ?'
      ).run(title ?? null, body ?? null, now, id);
      const updated = db.prepare('SELECT id, title, body, updated_at as updatedAt FROM notes WHERE id = ?').get(id);
      return json(res, 200, updated);
    }

    res.writeHead(404).end();
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`notes server listening on http://localhost:${PORT}`);
});
