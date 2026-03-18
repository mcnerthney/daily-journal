'use strict';

/**
 * Thin wrapper around lowdb v1 (CommonJS, no native compilation needed).
 * Stores all data in a single JSON file on the device's writable storage.
 *
 * Collections:
 *   users   – { id, email, passwordHash, createdAt }
 *   entries – { id, userId, date, data (object), updatedAt, synced (0|1) }
 *   lists   – { id, userId, name, items (array), updatedAt, synced (0|1) }
 *   meta    – { key, value }  (e.g. lastSyncAt per user)
 */

const low     = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path    = require('path');
const fs      = require('fs');

// On Android, nodejs-mobile sets DATA_DIR to the app's files directory.
// Outside of Android (local dev) it falls back to the OS home dir.
const DATA_DIR = process.env.DATA_DIR || require('os').homedir();
const DB_FILE  = path.join(DATA_DIR, 'daily-journal.db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const adapter = new FileSync(DB_FILE);
const db      = low(adapter);

// Set defaults for each collection
db.defaults({
  users:   [],
  entries: [],
  lists:   [],
  meta:    [],
}).write();

// ─── users ────────────────────────────────────────────────────────────────────

function findUserByEmail(email) {
  return db.get('users').find({ email: email.trim().toLowerCase() }).value();
}

function findUserById(id) {
  return db.get('users').find({ id }).value();
}

function insertUser(user) {
  db.get('users').push(user).write();
}

// ─── entries ──────────────────────────────────────────────────────────────────

function getAllEntries(userId) {
  return db.get('entries').filter({ userId }).value();
}

function getEntry(userId, date) {
  return db.get('entries').find({ userId, date }).value();
}

/**
 * Upsert an entry.  synced=0 flags it as pending upload to the remote server.
 */
function upsertEntry({ id, userId, date, data, updatedAt, synced = 0 }) {
  const existing = getEntry(userId, date);
  if (existing) {
    db.get('entries')
      .find({ userId, date })
      .assign({ data, updatedAt, synced })
      .write();
  } else {
    db.get('entries').push({ id, userId, date, data, updatedAt, synced }).write();
  }
}

/**
 * Return all entries that have not yet been pushed to the remote server.
 */
function getPendingEntries(userId) {
  return db.get('entries').filter({ userId, synced: 0 }).value();
}

/**
 * Mark a list of entries (by date) as synced so they are not re-uploaded.
 */
function markEntriesSynced(userId, dates) {
  dates.forEach((date) => {
    db.get('entries').find({ userId, date }).assign({ synced: 1 }).write();
  });
}

// ─── sync meta ────────────────────────────────────────────────────────────────

function getSyncMeta(userId) {
  const row = db.get('meta').find({ key: `lastSync_${userId}` }).value();
  return row ? row.value : null;
}

function setSyncMeta(userId, isoTimestamp) {
  const key = `lastSync_${userId}`;
  const existing = db.get('meta').find({ key }).value();
  if (existing) {
    db.get('meta').find({ key }).assign({ value: isoTimestamp }).write();
  } else {
    db.get('meta').push({ key, value: isoTimestamp }).write();
  }
}

module.exports = {
  // users
  findUserByEmail,
  findUserById,
  insertUser,
  // entries
  getAllEntries,
  getEntry,
  upsertEntry,
  getPendingEntries,
  markEntriesSynced,
  // meta
  getSyncMeta,
  setSyncMeta,
};
