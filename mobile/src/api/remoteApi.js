/**
 * remoteApi.js
 *
 * HTTP client for the remote Daily Journal server (the existing Express +
 * MongoDB backend running in the cloud or on the LAN).
 *
 * Set REMOTE_BASE_URL in the app's config or environment.  The default
 * points to localhost for development; change it before shipping to production.
 */

import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Remote base URL ───────────────────────────────────────────────────────────
// Change this to your deployed server URL, e.g. 'https://your-app.run.app'
export const REMOTE_BASE_URL = 'http://192.168.1.100:4000'; // ← update this

const REMOTE_TOKEN_KEY = 'dj_remote_token';

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Remote token persistence ──────────────────────────────────────────────────

export async function getRemoteToken() {
  return AsyncStorage.getItem(REMOTE_TOKEN_KEY);
}

export async function setRemoteToken(token) {
  await AsyncStorage.setItem(REMOTE_TOKEN_KEY, token);
}

export async function clearRemoteToken() {
  await AsyncStorage.removeItem(REMOTE_TOKEN_KEY);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function remoteLogin(email, password) {
  const { data } = await axios.post(`${REMOTE_BASE_URL}/api/login`, {
    email,
    password,
  });
  return data; // { token }
}

export async function remoteRegister(email, password) {
  const { data } = await axios.post(`${REMOTE_BASE_URL}/api/register`, {
    email,
    password,
  });
  return data; // { token }
}

// ── Journal entries ───────────────────────────────────────────────────────────

/**
 * Fetch all entries from the remote server.
 * Returns an object keyed by YYYY-MM-DD date strings.
 */
export async function remoteFetchEntries(token) {
  const { data } = await axios.get(`${REMOTE_BASE_URL}/api/entries`, {
    headers: authHeader(token),
  });
  return data; // { "2026-03-18": { mood: ..., ... }, ... }
}

/**
 * Upload a single entry to the remote server.
 * Uses PUT /api/entries/:date, matching the existing server API.
 */
export async function remoteSaveEntry(token, date, entryData) {
  await axios.put(`${REMOTE_BASE_URL}/api/entries/${date}`, entryData, {
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
  });
}

// ── Connectivity helper ───────────────────────────────────────────────────────

/**
 * Quick reachability check against the remote server.
 * Returns true if the server responds to the health endpoint.
 */
export async function isRemoteReachable() {
  try {
    await axios.get(`${REMOTE_BASE_URL}/health`, { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}
