/**
 * SyncButton.jsx
 *
 * A self-contained UI component that triggers a full bidirectional sync.
 * Shows a progress log and the result of the last sync run.
 *
 * Props:
 *   localToken   {string}            – JWT for the on-device server
 *   remoteToken  {string|null}       – JWT for the remote server (null = not signed in remotely)
 *   onSyncDone   {(result) => void}  – called after a successful sync
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { syncAll } from '../sync/syncManager';

const STATUS = { IDLE: 'idle', SYNCING: 'syncing', DONE: 'done', ERROR: 'error' };

export default function SyncButton({ localToken, remoteToken, onSyncDone }) {
  const [status, setStatus]         = useState(STATUS.IDLE);
  const [log, setLog]               = useState([]);
  const [lastResult, setLastResult] = useState(null);

  const appendLog = useCallback((msg) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const handleSync = useCallback(async () => {
    if (status === STATUS.SYNCING) return;
    if (!remoteToken) {
      appendLog('⚠️  Sign in to the remote server first (Settings → Remote Account).');
      setStatus(STATUS.ERROR);
      return;
    }

    setStatus(STATUS.SYNCING);
    setLog([]);
    appendLog('Starting sync…');

    try {
      const result = await syncAll({
        localToken,
        remoteToken,
        onProgress: appendLog,
      });

      setLastResult(result);
      setStatus(STATUS.DONE);
      appendLog(`✅  Pushed ${result.pushed}, pulled ${result.pulled}.`);

      if (result.errors.length) {
        result.errors.forEach((e) => appendLog(`⚠️  ${e}`));
        setStatus(STATUS.ERROR);
      }

      onSyncDone?.(result);
    } catch (err) {
      appendLog(`❌  ${err.message}`);
      setStatus(STATUS.ERROR);
    }
  }, [status, localToken, remoteToken, onSyncDone, appendLog]);

  const buttonDisabled = status === STATUS.SYNCING;
  const buttonBg = {
    [STATUS.IDLE]:    '#4F8EF7',
    [STATUS.SYNCING]: '#4F8EF7',
    [STATUS.DONE]:    '#34C759',
    [STATUS.ERROR]:   '#FF3B30',
  }[status];

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: buttonBg }, buttonDisabled && styles.buttonDisabled]}
        onPress={handleSync}
        disabled={buttonDisabled}
        accessibilityLabel="Sync data with remote server"
        accessibilityRole="button"
      >
        {status === STATUS.SYNCING ? (
          <ActivityIndicator color="#fff" style={styles.spinner} />
        ) : null}
        <Text style={styles.buttonText}>
          {status === STATUS.SYNCING ? 'Syncing…' : 'Sync Now'}
        </Text>
      </TouchableOpacity>

      {lastResult && status === STATUS.DONE && (
        <Text style={styles.summary}>
          Last sync: ↑ {lastResult.pushed} uploaded · ↓ {lastResult.pulled} downloaded
        </Text>
      )}

      {log.length > 0 && (
        <ScrollView style={styles.logBox} nestedScrollEnabled>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 16,
  },
  button: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical:   14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  spinner: {
    marginRight: 8,
  },
  buttonText: {
    color:      '#fff',
    fontSize:   16,
    fontWeight: '600',
  },
  summary: {
    textAlign: 'center',
    color:     '#666',
    fontSize:  13,
  },
  logBox: {
    maxHeight:    180,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding:      10,
  },
  logLine: {
    fontSize:   12,
    color:      '#333',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
});
