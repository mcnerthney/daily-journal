/**
 * syncManager.js
 *
 * Implements a two-phase, manual sync between the on-device SQLite/lowdb store
 * and the remote MongoDB-backed server.
 *
 * Phase 1 – PUSH:  Upload all locally-modified (synced=0) entries to remote.
 * Phase 2 – PULL:  Download all remote entries and merge them into local DB.
 *
 * Conflict strategy: last-write-wins based on `updatedAt` timestamp.
 * The device's local changes always go up first, then remote data comes down
 * and can overwrite older local records.
 *
 * Usage:
 *   import { syncAll } from './syncManager';
 *   const result = await syncAll({ localToken, remoteToken });
 *   // result = { pushed: 3, pulled: 7, errors: [] }
 */

import {
  localGetPendingEntries,
  localMarkSynced,
  localApplyRemoteEntries,
  localGetSyncMeta,
  localSetSyncMeta,
} from '../api/localApi';

import {
  remoteSaveEntry,
  remoteFetchEntries,
  isRemoteReachable,
} from '../api/remoteApi';

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * Run a full bidirectional sync.
 *
 * @param {object}   opts
 * @param {string}   opts.localToken   – JWT from the on-device server
 * @param {string}   opts.remoteToken  – JWT from the remote server
 * @param {Function} [opts.onProgress] – optional (message: string) => void
 * @returns {Promise<{ pushed: number, pulled: number, errors: string[] }>}
 */
export async function syncAll({ localToken, remoteToken, onProgress = () => {} }) {
  const errors = [];
  let pushed = 0;
  let pulled = 0;

  // ── Pre-flight: check connectivity ─────────────────────────────────────────
  onProgress('Checking remote server connectivity…');
  const online = await isRemoteReachable();
  if (!online) {
    throw new Error('Remote server is not reachable. Check your network connection.');
  }

  // ── Phase 1: PUSH local changes to remote ──────────────────────────────────
  onProgress('Fetching pending local entries…');
  const pending = await localGetPendingEntries(localToken);

  onProgress(`Pushing ${pending.length} local change(s) to remote…`);
  const syncedDates = [];

  for (const entry of pending) {
    try {
      await remoteSaveEntry(remoteToken, entry.date, entry.data);
      syncedDates.push(entry.date);
      pushed++;
    } catch (err) {
      const msg = `Push failed for ${entry.date}: ${err.message}`;
      errors.push(msg);
      console.warn('[SyncManager]', msg);
    }
  }

  // Mark successfully-uploaded entries as synced in local DB
  if (syncedDates.length > 0) {
    await localMarkSynced(localToken, syncedDates);
  }

  // ── Phase 2: PULL remote entries into local DB ─────────────────────────────
  onProgress('Fetching all entries from remote…');
  let remoteEntries = {};

  try {
    remoteEntries = await remoteFetchEntries(remoteToken);
  } catch (err) {
    const msg = `Pull failed: ${err.message}`;
    errors.push(msg);
    console.warn('[SyncManager]', msg);
  }

  const remoteArray = Object.entries(remoteEntries).map(([date, data]) => ({
    date,
    data,
    updatedAt: new Date().toISOString(), // remote server doesn't expose updatedAt per entry yet
  }));

  if (remoteArray.length > 0) {
    onProgress(`Applying ${remoteArray.length} remote entry(s) to local DB…`);
    try {
      await localApplyRemoteEntries(localToken, remoteArray);
      pulled = remoteArray.length;
    } catch (err) {
      const msg = `Apply failed: ${err.message}`;
      errors.push(msg);
      console.warn('[SyncManager]', msg);
    }
  }

  // ── Record sync timestamp ──────────────────────────────────────────────────
  const now = new Date().toISOString();
  try {
    await localSetSyncMeta(localToken, now);
  } catch {
    // non-fatal
  }

  onProgress('Sync complete.');
  return { pushed, pulled, errors, syncedAt: now };
}

// ── Convenience: read last sync time ─────────────────────────────────────────

export async function getLastSyncTime(localToken) {
  try {
    return await localGetSyncMeta(localToken);
  } catch {
    return null;
  }
}
