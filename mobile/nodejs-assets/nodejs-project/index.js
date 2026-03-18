'use strict';

/**
 * On-device Express API server.
 *
 * Runs inside nodejs-mobile-react-native on port 4001 (localhost only).
 * React Native makes HTTP calls to http://localhost:4001/api/* for all
 * local data operations.
 *
 * Key differences from the remote server (server/index.js):
 *   - MongoDB → lowdb (pure-JS JSON file, no native deps)
 *   - No Socket.io (RN uses the rn-bridge channel instead)
 *   - No email/SMTP (not needed for local auth)
 *   - Adds /api/sync/* endpoints that the SyncManager uses
 */

const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const db = require('./db/database');

// ── Config ───────────────────────────────────────────────────────────────────
const PORT       = 4001;
// NOTE: this secret only protects the local loopback interface on the device.
// It is intentionally simple – the real security boundary is the OS process
// isolation, not this token.
const JWT_SECRET = process.env.LOCAL_JWT_SECRET || 'local-device-jwt-secret';

// ── App setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth routes ───────────────────────────────────────────────────────────────

// Register a new local account (first device use)
app.post('/api/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalized = email.trim().toLowerCase();
  if (db.findUserByEmail(normalized)) {
    return res.status(409).json({ error: 'Email already registered on this device' });
  }

  const id           = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);
  db.insertUser({ id, email: normalized, passwordHash, createdAt: new Date().toISOString() });

  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, userId: id });
});

// Login with local credentials
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.findUserByEmail(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, userId: user.id });
});

// ── Journal entry routes ──────────────────────────────────────────────────────

// GET /api/entries  →  { "2026-03-18": { mood: ..., ... }, ... }
app.get('/api/entries', auth, (req, res) => {
  const rows   = db.getAllEntries(req.userId);
  const result = {};
  for (const row of rows) {
    result[row.date] = typeof row.data === 'object' ? row.data : {};
  }
  res.json(result);
});

// PUT /api/entries/:date  →  saves or replaces a single day's entry
app.put('/api/entries/:date', auth, (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  db.upsertEntry({
    id:        crypto.randomUUID(),
    userId:    req.userId,
    date,
    data:      req.body,
    updatedAt: new Date().toISOString(),
    synced:    0,   // newly written → needs to be pushed to remote
  });

  res.json({ ok: true });
});

// ── Sync-support routes ───────────────────────────────────────────────────────

/**
 * GET /api/sync/pending
 * Returns all entries that have been modified locally but not yet pushed to
 * the remote server (synced === 0).
 */
app.get('/api/sync/pending', auth, (req, res) => {
  const pending = db.getPendingEntries(req.userId);
  res.json(pending);
});

/**
 * POST /api/sync/mark-synced   { dates: ["2026-03-18", ...] }
 * Called by SyncManager after successfully uploading entries to the remote.
 */
app.post('/api/sync/mark-synced', auth, (req, res) => {
  const { dates } = req.body || {};
  if (!Array.isArray(dates)) {
    return res.status(400).json({ error: '`dates` array is required' });
  }
  db.markEntriesSynced(req.userId, dates);
  res.json({ ok: true, marked: dates.length });
});

/**
 * POST /api/sync/apply   { entries: [{ date, data, updatedAt }] }
 * Called by SyncManager to persist entries that were fetched from the remote.
 * These are stored with synced=1 so they are not re-uploaded.
 */
app.post('/api/sync/apply', auth, (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: '`entries` array is required' });
  }

  for (const entry of entries) {
    if (!entry || !entry.date) continue;
    db.upsertEntry({
      id:        crypto.randomUUID(),
      userId:    req.userId,
      date:      entry.date,
      data:      entry.data || {},
      updatedAt: entry.updatedAt || new Date().toISOString(),
      synced:    1,   // came from remote → already in sync
    });
  }

  res.json({ ok: true, applied: entries.length });
});

/**
 * GET /api/sync/meta  →  { lastSyncAt: "2026-03-18T10:00:00Z" | null }
 * POST /api/sync/meta  { lastSyncAt: "..." }
 */
app.get('/api/sync/meta', auth, (req, res) => {
  res.json({ lastSyncAt: db.getSyncMeta(req.userId) });
});

app.post('/api/sync/meta', auth, (req, res) => {
  const { lastSyncAt } = req.body || {};
  if (!lastSyncAt) return res.status(400).json({ error: 'lastSyncAt required' });
  db.setSyncMeta(req.userId, lastSyncAt);
  res.json({ ok: true });
});

// ── Health-check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[on-device] Local API listening on http://127.0.0.1:${PORT}`);

  // Notify the React Native layer that the server is ready
  try {
    const bridge = require('rn-bridge');
    bridge.channel.send(JSON.stringify({ type: 'server-ready', port: PORT }));
  } catch {
    // Not running inside nodejs-mobile (e.g. local dev / CI)
    console.log('[on-device] rn-bridge not available – running outside nodejs-mobile');
  }
});
