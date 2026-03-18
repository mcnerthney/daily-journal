/**
 * App.jsx – Root component for Daily Journal Mobile
 *
 * Responsibilities:
 *  1. Start the on-device Node.js server via nodejs-mobile-react-native.
 *  2. Wait for the server-ready signal on the rn-bridge channel.
 *  3. Handle local auth (login/register against localhost:4001).
 *  4. Handle optional remote auth (for sync).
 *  5. Render the JournalScreen once the local server is up.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import nodejs from 'nodejs-mobile-react-native';

import { localLogin, localRegister } from './src/api/localApi';
import { remoteLogin, getRemoteToken, setRemoteToken } from './src/api/remoteApi';
import JournalScreen from './src/screens/JournalScreen';

const LOCAL_TOKEN_KEY  = 'dj_local_token';
const SERVER_START_TIMEOUT_MS = 15_000;

export default function App() {
  const [serverReady, setServerReady]     = useState(false);
  const [serverError, setServerError]     = useState(null);
  const [localToken, setLocalToken]       = useState(null);
  const [remoteToken, setRemoteToken_]    = useState(null);
  const [authMode, setAuthMode]           = useState('login'); // 'login' | 'register'
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [authLoading, setAuthLoading]     = useState(false);

  // ── 1. Start the on-device Node.js server ─────────────────────────────────
  useEffect(() => {
    // Pass the writable data directory so lowdb can persist its JSON file.
    const dataDir = Platform.select({
      android: '/data/data/com.dailyjournalmobile/files',
      ios:     `${global.__rn_fileDir ?? ''}`,
      default: '',
    });

    nodejs.start('index.js', {
      // environment variables forwarded to the Node.js process
      env: { DATA_DIR: dataDir },
    });

    // Listen for messages from the Node.js side
    const subscription = nodejs.channel.addListener('message', (msg) => {
      try {
        const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
        if (parsed.type === 'server-ready') {
          setServerReady(true);
        }
      } catch {
        // ignore non-JSON messages
      }
    });

    // Timeout guard: if server hasn't signaled ready within the limit,
    // show an actionable error instead of hanging indefinitely.
    const timeout = setTimeout(() => {
      setServerError(
        'On-device server did not start within 15 seconds.\n' +
        'Ensure nodejs-mobile-react-native is correctly linked and the ' +
        'nodejs-assets folder was bundled with the APK.',
      );
    }, SERVER_START_TIMEOUT_MS);

    return () => {
      subscription.remove();
      clearTimeout(timeout);
    };
  }, []);

  // ── 2. Restore persisted tokens after server is ready ─────────────────────
  useEffect(() => {
    if (!serverReady) return;
    (async () => {
      const [local, remote] = await Promise.all([
        AsyncStorage.getItem(LOCAL_TOKEN_KEY),
        getRemoteToken(),
      ]);
      if (local)  setLocalToken(local);
      if (remote) setRemoteToken_(remote);
    })();
  }, [serverReady]);

  // ── 3. Auth actions ───────────────────────────────────────────────────────
  const handleLocalAuth = useCallback(async () => {
    if (!email || !password) {
      Alert.alert('Validation', 'Please enter email and password.');
      return;
    }
    setAuthLoading(true);
    try {
      const fn     = authMode === 'register' ? localRegister : localLogin;
      const result = await fn(email, password);
      await AsyncStorage.setItem(LOCAL_TOKEN_KEY, result.token);
      setLocalToken(result.token);
    } catch (err) {
      const msg = err.response?.data?.error ?? err.message;
      Alert.alert('Auth failed', msg);
    } finally {
      setAuthLoading(false);
    }
  }, [email, password, authMode]);

  const handleRemoteLogin = useCallback(async () => {
    if (!email || !password) {
      Alert.alert('Validation', 'Please enter email and password for the remote account.');
      return;
    }
    setAuthLoading(true);
    try {
      const result = await remoteLogin(email, password);
      await setRemoteToken(result.token);
      setRemoteToken_(result.token);
      Alert.alert('Remote login', 'Connected to remote server. You can now sync.');
    } catch (err) {
      const msg = err.response?.data?.error ?? err.message;
      Alert.alert('Remote login failed', msg);
    } finally {
      setAuthLoading(false);
    }
  }, [email, password]);

  const handleSignOut = useCallback(async () => {
    await AsyncStorage.removeItem(LOCAL_TOKEN_KEY);
    setLocalToken(null);
  }, []);

  // ── Render: server not ready yet ──────────────────────────────────────────
  if (serverError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Server failed to start</Text>
        <Text style={styles.errorMsg}>{serverError}</Text>
      </View>
    );
  }

  if (!serverReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F8EF7" />
        <Text style={styles.loadingText}>Starting on-device server…</Text>
      </View>
    );
  }

  // ── Render: auth screen ───────────────────────────────────────────────────
  if (!localToken) {
    return (
      <KeyboardAvoidingView
        style={styles.authScreen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.authContent}>
          <Text style={styles.authTitle}>Daily Journal</Text>
          <Text style={styles.authSubtitle}>
            {authMode === 'login'
              ? 'Sign in to your on-device account'
              : 'Create an on-device account'}
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#aaa"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#aaa"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleLocalAuth}
            disabled={authLoading}
          >
            {authLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryBtnText}>
                  {authMode === 'login' ? 'Sign In' : 'Create Account'}
                </Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setAuthMode((m) => (m === 'login' ? 'register' : 'login'))}
            style={styles.switchBtn}
          >
            <Text style={styles.switchBtnText}>
              {authMode === 'login'
                ? "Don't have an account? Create one"
                : 'Already have an account? Sign in'}
            </Text>
          </TouchableOpacity>

          {!remoteToken && (
            <>
              <View style={styles.divider} />
              <Text style={styles.remoteSectionTitle}>Remote server (optional, for sync)</Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleRemoteLogin}
                disabled={authLoading}
              >
                <Text style={styles.secondaryBtnText}>Connect Remote Account</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Render: main journal ──────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <JournalScreen localToken={localToken} remoteToken={remoteToken} />

      {/* Sign-out footer */}
      <TouchableOpacity style={styles.signOutBar} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f9f9fb' },
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    padding:        24,
    backgroundColor: '#f9f9fb',
  },
  loadingText:  { marginTop: 16, color: '#666', fontSize: 15 },
  errorTitle:   { fontSize: 18, fontWeight: '700', color: '#FF3B30', marginBottom: 10 },
  errorMsg:     { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 20 },

  // ── Auth screen ───────────────────────────────────────────────────────────
  authScreen:  { flex: 1, backgroundColor: '#fff' },
  authContent: { padding: 24, paddingTop: Platform.OS === 'android' ? 40 : 80 },
  authTitle: {
    fontSize:   28,
    fontWeight: '800',
    color:      '#222',
    marginBottom: 6,
  },
  authSubtitle: {
    fontSize:    14,
    color:       '#888',
    marginBottom: 28,
  },
  input: {
    height:       50,
    borderWidth:   1,
    borderColor:  '#DDD',
    borderRadius:  10,
    paddingHorizontal: 14,
    fontSize:     15,
    color:        '#222',
    marginBottom:  12,
    backgroundColor: '#FAFAFA',
  },
  primaryBtn: {
    height:          52,
    backgroundColor: '#4F8EF7',
    borderRadius:    12,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:        4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchBtn:      { marginTop: 14, alignItems: 'center' },
  switchBtnText:  { color: '#4F8EF7', fontSize: 14 },
  divider: {
    height:           1,
    backgroundColor:  '#EEE',
    marginVertical:   24,
  },
  remoteSectionTitle: {
    fontSize:     13,
    fontWeight:   '600',
    color:        '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom:  12,
  },
  secondaryBtn: {
    height:       48,
    borderWidth:   1,
    borderColor:  '#4F8EF7',
    borderRadius:  12,
    alignItems:   'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#4F8EF7', fontSize: 15, fontWeight: '600' },

  // ── Sign-out ──────────────────────────────────────────────────────────────
  signOutBar: {
    height:          44,
    backgroundColor: '#FFF',
    borderTopWidth:   1,
    borderTopColor:  '#EEE',
    alignItems:      'center',
    justifyContent:  'center',
  },
  signOutText: { color: '#FF3B30', fontSize: 14 },
});
