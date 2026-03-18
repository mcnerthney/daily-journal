/**
 * localApi.js
 *
 * Thin HTTP client that talks to the on-device Express server
 * running on http://127.0.0.1:4001 via nodejs-mobile.
 *
 * All methods accept an `authToken` string and throw on non-2xx responses.
 */

import axios from 'axios';

const LOCAL_BASE = 'http://127.0.0.1:4001';

function headers(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function localRegister(email, password) {
  const { data } = await axios.post(`${LOCAL_BASE}/api/register`, { email, password });
  return data; // { token, userId }
}

export async function localLogin(email, password) {
  const { data } = await axios.post(`${LOCAL_BASE}/api/login`, { email, password });
  return data; // { token, userId }
}

// ── Journal entries ───────────────────────────────────────────────────────────

/**
 * Fetch all entries for the authenticated user.
 * Returns { "2026-03-18": { mood: ..., ... }, ... }
 */
export async function localFetchEntries(token) {
  const { data } = await axios.get(`${LOCAL_BASE}/api/entries`, { headers: headers(token) });
  return data;
}

/**
 * Save (upsert) a single day's entry.
 * Automatically flags it as synced=0 (pending upload).
 */
export async function localSaveEntry(token, date, entryData) {
  await axios.put(`${LOCAL_BASE}/api/entries/${date}`, entryData, {
    headers: headers(token),
  });
}

// ── Sync-support ──────────────────────────────────────────────────────────────

/** Returns entries that have been modified locally but not yet uploaded. */
export async function localGetPendingEntries(token) {
  const { data } = await axios.get(`${LOCAL_BASE}/api/sync/pending`, {
    headers: headers(token),
  });
  return data; // [{ id, userId, date, data, updatedAt, synced }, ...]
}

/** Mark a list of dates as synced after successful remote upload. */
export async function localMarkSynced(token, dates) {
  await axios.post(
    `${LOCAL_BASE}/api/sync/mark-synced`,
    { dates },
    { headers: headers(token) },
  );
}

/** Store entries that were fetched from the remote server. */
export async function localApplyRemoteEntries(token, entries) {
  await axios.post(
    `${LOCAL_BASE}/api/sync/apply`,
    { entries },
    { headers: headers(token) },
  );
}

/** Read the timestamp of the last successful sync. */
export async function localGetSyncMeta(token) {
  const { data } = await axios.get(`${LOCAL_BASE}/api/sync/meta`, {
    headers: headers(token),
  });
  return data.lastSyncAt; // ISO string or null
}

/** Persist the timestamp of the most recent successful sync. */
export async function localSetSyncMeta(token, lastSyncAt) {
  await axios.post(
    `${LOCAL_BASE}/api/sync/meta`,
    { lastSyncAt },
    { headers: headers(token) },
  );
}
