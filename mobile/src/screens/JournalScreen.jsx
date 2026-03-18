/**
 * JournalScreen.jsx
 *
 * Main journal screen for the Android app.
 * Uses the on-device API (localhost:4001) for all reads and writes so the
 * app works fully offline.  The SyncButton pushes queued changes to remote
 * when the user explicitly initiates a sync.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';

import { localFetchEntries, localSaveEntry } from '../api/localApi';
import SyncButton from '../components/SyncButton';

// YYYY-MM-DD for today in the device's local timezone
function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

const MOODS = ['😊 Great', '🙂 Good', '😐 Okay', '😔 Low', '😢 Bad'];

export default function JournalScreen({ localToken, remoteToken }) {
  const [entries, setEntries]       = useState({});
  const [date, setDate]             = useState(todayKey());
  const [draft, setDraft]           = useState({ mood: '', notes: '' });
  const [saving, setSaving]         = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSync, setShowSync]     = useState(false);

  // ── Load all entries from local DB on mount ────────────────────────────────
  const loadEntries = useCallback(async () => {
    try {
      const data = await localFetchEntries(localToken);
      setEntries(data);
      // Pre-fill draft with whatever is stored for today
      const todayEntry = data[todayKey()] || {};
      setDraft({ mood: todayEntry.mood || '', notes: todayEntry.notes || '' });
    } catch (err) {
      Alert.alert('Error', `Failed to load entries: ${err.message}`);
    }
  }, [localToken]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ── Switch day ─────────────────────────────────────────────────────────────
  const selectDay = useCallback((d) => {
    setDate(d);
    const entry = entries[d] || {};
    setDraft({ mood: entry.mood || '', notes: entry.notes || '' });
  }, [entries]);

  // ── Auto-save on draft change ──────────────────────────────────────────────
  useEffect(() => {
    if (!localToken) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        await localSaveEntry(localToken, date, draft);
        setEntries((prev) => ({ ...prev, [date]: draft }));
      } catch (err) {
        console.warn('Auto-save failed', err.message);
      } finally {
        setSaving(false);
      }
    }, 800); // debounce 800 ms
    return () => clearTimeout(t);
  }, [draft, date, localToken]);

  // ── Pull-to-refresh ────────────────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEntries();
    setRefreshing(false);
  }, [loadEntries]);

  // ── Date navigation (prev / next day) ─────────────────────────────────────
  const shiftDate = (delta) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    selectDay(d.toLocaleDateString('en-CA'));
  };

  const sortedDates = Object.keys(entries).sort().reverse();

  return (
    <ScrollView
      style={styles.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>Daily Journal</Text>

        <TouchableOpacity
          style={styles.syncToggle}
          onPress={() => setShowSync((v) => !v)}
          accessibilityLabel="Toggle sync panel"
        >
          <Text style={styles.syncToggleText}>{showSync ? 'Hide Sync ↑' : 'Sync ↑'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Sync panel (collapsed by default) ─────────────────────────────── */}
      {showSync && (
        <View style={styles.syncPanel}>
          <Text style={styles.syncTitle}>Sync with Remote Server</Text>
          <SyncButton
            localToken={localToken}
            remoteToken={remoteToken}
            onSyncDone={() => loadEntries()}
          />
        </View>
      )}

      {/* ── Date navigation ────────────────────────────────────────────────── */}
      <View style={styles.dateNav}>
        <TouchableOpacity onPress={() => shiftDate(-1)} style={styles.navBtn}>
          <Text style={styles.navBtnText}>‹ Prev</Text>
        </TouchableOpacity>
        <Text style={styles.dateLabel}>
          {date === todayKey() ? 'Today' : date}
        </Text>
        <TouchableOpacity
          onPress={() => shiftDate(1)}
          style={[styles.navBtn, date === todayKey() && styles.navBtnDisabled]}
          disabled={date === todayKey()}
        >
          <Text style={styles.navBtnText}>Next ›</Text>
        </TouchableOpacity>
      </View>

      {/* ── Entry editor ───────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>How are you feeling?</Text>
        <View style={styles.moodRow}>
          {MOODS.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.moodChip, draft.mood === m && styles.moodChipActive]}
              onPress={() => setDraft((d) => ({ ...d, mood: d.mood === m ? '' : m }))}
            >
              <Text style={styles.moodChipText}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Write about your day…"
          placeholderTextColor="#aaa"
          multiline
          value={draft.notes}
          onChangeText={(t) => setDraft((d) => ({ ...d, notes: t }))}
        />

        <Text style={styles.savingLabel}>{saving ? 'Saving…' : 'Saved locally ✓'}</Text>
      </View>

      {/* ── History list ───────────────────────────────────────────────────── */}
      {sortedDates.length > 0 && (
        <View style={styles.historySection}>
          <Text style={styles.sectionLabel}>History</Text>
          {sortedDates.slice(0, 14).map((d) => {
            const e = entries[d] || {};
            return (
              <TouchableOpacity key={d} style={styles.historyItem} onPress={() => selectDay(d)}>
                <Text style={styles.historyDate}>{d === todayKey() ? 'Today' : d}</Text>
                {e.mood ? <Text style={styles.historyMood}>{e.mood}</Text> : null}
                {e.notes ? (
                  <Text style={styles.historyNotes} numberOfLines={1}>
                    {e.notes}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f9f9fb',
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop:        Platform.OS === 'android' ? 16 : 52,
    paddingBottom:     12,
    backgroundColor:   '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  appTitle: {
    fontSize:   20,
    fontWeight: '700',
    color:      '#222',
  },
  syncToggle: {
    paddingHorizontal: 12,
    paddingVertical:    6,
    backgroundColor:   '#EFF6FF',
    borderRadius:      8,
  },
  syncToggleText: {
    color:      '#4F8EF7',
    fontWeight: '600',
    fontSize:   14,
  },
  syncPanel: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop:        12,
    borderRadius:     12,
    borderWidth:      1,
    borderColor:      '#E0EAFF',
    overflow:         'hidden',
  },
  syncTitle: {
    fontSize:    15,
    fontWeight:  '600',
    color:       '#333',
    padding:     12,
    paddingBottom: 0,
  },
  dateNav: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical:   14,
  },
  navBtn: {
    paddingHorizontal: 14,
    paddingVertical:    8,
    backgroundColor:   '#fff',
    borderRadius:       8,
    borderWidth:        1,
    borderColor:        '#ddd',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navBtnText: {
    fontSize: 14,
    color:    '#555',
  },
  dateLabel: {
    fontSize:   16,
    fontWeight: '600',
    color:      '#333',
  },
  card: {
    backgroundColor:   '#fff',
    marginHorizontal:  16,
    borderRadius:      14,
    padding:           16,
    shadowColor:       '#000',
    shadowOpacity:     0.04,
    shadowRadius:      4,
    shadowOffset:      { width: 0, height: 2 },
    elevation:         2,
  },
  sectionLabel: {
    fontSize:     13,
    fontWeight:   '600',
    color:        '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom:  8,
    marginTop:     12,
  },
  moodRow: {
    flexWrap:  'wrap',
    flexDirection: 'row',
    gap:        8,
    marginBottom: 4,
  },
  moodChip: {
    paddingHorizontal: 12,
    paddingVertical:    6,
    borderRadius:       20,
    backgroundColor:   '#F2F2F7',
  },
  moodChipActive: {
    backgroundColor: '#4F8EF7',
  },
  moodChipText: {
    fontSize: 13,
    color:    '#333',
  },
  notesInput: {
    minHeight:        100,
    backgroundColor:  '#FAFAFA',
    borderWidth:       1,
    borderColor:      '#E5E5EA',
    borderRadius:      10,
    padding:           12,
    fontSize:          15,
    color:            '#222',
    textAlignVertical: 'top',
  },
  savingLabel: {
    marginTop: 8,
    fontSize:  12,
    color:     '#aaa',
    textAlign: 'right',
  },
  historySection: {
    marginHorizontal: 16,
    marginTop:        20,
    marginBottom:     40,
  },
  historyItem: {
    backgroundColor: '#fff',
    borderRadius:     10,
    padding:          12,
    marginBottom:      8,
    borderWidth:       1,
    borderColor:      '#EFEFEF',
  },
  historyDate: {
    fontSize:   13,
    fontWeight: '700',
    color:      '#444',
    marginBottom: 2,
  },
  historyMood: {
    fontSize: 13,
    color:    '#555',
  },
  historyNotes: {
    fontSize: 12,
    color:    '#888',
    marginTop:  2,
  },
});
