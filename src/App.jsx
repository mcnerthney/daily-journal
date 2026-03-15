import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";

import {
  API,
  getTodayKey,
  formatDate,
  getRelativeDateLabel,
  fetchAllEntries,
  saveEntry,
  fetchPublicList,
} from "./utils";
import {
  MOODS,
  MEDICATIONS,
  FOODS,
  HYGIENE,
  CLEANING,
  WORKOUTS,
} from "./data";

import ToggleChip from "./components/ToggleChip";
import Section from "./components/Section";
import MoodSelector from "./components/MoodSelector";
import ScoreBar from "./components/ScoreBar";
import EntryView from "./components/EntryView";
import Toast from "./components/Toast";
import SaveIndicator from "./components/SaveIndicator";
import AuthForm from "./components/AuthForm";
import WorkoutChart from "./components/WorkoutChart";
import BpChart from "./components/BpChart";
import Lists from "./components/Lists";

// list of top‑level features that can appear on the home screen
const FEATURES = [
  { key: "journal", label: "Daily Journal" },
  { key: "lists", label: "Lists" },
  // additional features can be added here later
];

const THEMES = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "festive", label: "Festive" },
];

const JOURNAL_VIEW_LABELS = {
  today: "Entry",
  history: "History",
  chart: "Stats",
};

// auth helper methods
async function doLogin(email, password) {
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Login failed");
  }
  return res.json(); // { token }
}

async function doRegister(email, password) {
  const res = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Registration failed");
  }
  return res.json();
}

async function doRequestPasswordReset(email) {
  const res = await fetch(`${API}/password-reset/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not request password reset");
  }
  return res.json();
}

async function doConfirmPasswordReset(token, password) {
  const res = await fetch(`${API}/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not reset password");
  }
  return res.json();
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const defaultTitle = "Notebook";
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const [view, setView] = useState("today");
  // top‑level view: home menu vs. journal feature
  const [appView, setAppView] = useState("home");
  const [selectedListIdRoute, setSelectedListIdRoute] = useState(null);
  const [selectedListTitle, setSelectedListTitle] = useState("");
  const [publicListKey, setPublicListKey] = useState(null);
  const [publicListId, setPublicListId] = useState(null);
  const [publicList, setPublicList] = useState(null);

  const isUuid = useCallback((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v), []);

  const parseRoute = useCallback((route) => {
    const clean = (route || "").replace(/^#/, "");

    if (!clean) {
      return { appView: "home", selectedListId: null, resetJournalView: false };
    }
    if (clean === "journal") {
      return { appView: "journal", selectedListId: null, resetJournalView: true };
    }
    if (clean === "lists") {
      return { appView: "lists", selectedListId: null, resetJournalView: false };
    }

    const listEditMatch = clean.match(/^lists\/edit\/(.+)$/);
    if (listEditMatch) {
      let selectedListId = listEditMatch[1];
      try {
        selectedListId = decodeURIComponent(selectedListId);
      } catch (_) {
        // keep raw id if decode fails so route still resolves
      }
      return { appView: "lists", selectedListId, resetJournalView: false };
    }

    if (clean === "stats") {
      return { appView: "stats", selectedListId: null, resetJournalView: false };
    }

    return { appView: clean, selectedListId: null, resetJournalView: false };
  }, []);

  const applyRouteState = useCallback((routeState) => {
    setAppView(routeState.appView);
    setSelectedListIdRoute(routeState.selectedListId);
    if (routeState.appView !== "lists" || !routeState.selectedListId) {
      setSelectedListTitle("");
    }
    if (routeState.resetJournalView) {
      setView("today");
    }
  }, []);

  const navigateToRoute = useCallback((route, options = {}) => {
    const { replace = false } = options;
    const routeState = parseRoute(route);
    applyRouteState(routeState);

    const base = `${window.location.pathname}${window.location.search}`;
    const target = route ? `${base}#${route}` : base;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current === target) return;

    if (replace) {
      history.replaceState(null, "", target);
      return;
    }

    if (!route) {
      history.replaceState(null, "", base);
      return;
    }

    window.location.hash = route;
  }, [applyRouteState, parseRoute]);

  // derive feature metadata from the list
  const currentFeature = FEATURES.find(f => f.key === appView);
  const isListEditor = appView === "lists" && !!selectedListIdRoute;
  const featureTitle = appView === "lists" && selectedListIdRoute
    ? (selectedListTitle || "List Editor")
    : (currentFeature ? currentFeature.label : "");

  // which date are we currently editing? defaults to today but can be changed
  const currentDate = getTodayKey();
  const [activeDate, setActiveDate] = useState(currentDate);

  // --- handle public list routes ------------------------------------------------
  useEffect(() => {
    const match = window.location.pathname.match(/^\/lists\/public\/([^\/]+)(?:\/([^\/]+))?$/);
    if (match) {
      const primary = decodeURIComponent(match[1]);
      const optionalSlug = match[2] ? decodeURIComponent(match[2]) : null;
      const hasUuidPrimary = isUuid(primary);
      const fetchKey = optionalSlug || primary;

      setPublicListKey(fetchKey);
      if (hasUuidPrimary) setPublicListId(primary);

      fetchPublicList(fetchKey)
        .then((list) => {
          setPublicList(list);
          setPublicListId(list.publicId || null);
        })
        .catch(() => setPublicList(null));
    }
  }, [isUuid]);

  useEffect(() => {
    if (!publicListKey) {
      document.title = defaultTitle;
      return;
    }

    document.title = publicList?.name || "Public List";
  }, [defaultTitle, publicList, publicListKey]);

  // --- sync appView with URL hash ------------------------------------------------
  // when component mounts or hash changes, update state if it matches a feature

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      applyRouteState(parseRoute(hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [applyRouteState, parseRoute]);

  // keep localStorage in sync
  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("token");
    }
  }, [token]);

  useEffect(() => {
    const valid = THEMES.some((t) => t.key === theme) ? theme : "light";
    localStorage.setItem("theme", valid);
    document.documentElement.setAttribute("data-theme", valid);
  }, [theme]);
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [customMedInput, setCustomMedInput] = useState("");
  const [authMode, setAuthMode] = useState("login"); // or register
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [toast, setToast] = useState({ message: "", visible: false });
  // keep a constant for the real "today" so we can label toasts appropriately
  const today = currentDate;
  const activeDateLabel = getRelativeDateLabel(activeDate, today);
  const activeDatePromptTarget =
    activeDateLabel === "Today"
      ? "today"
      : activeDateLabel === "Yesterday"
        ? "yesterday"
        : `on ${activeDateLabel}`;
  const socketRef = useRef(null);

  // headers helper including auth token
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const activeEntry = entries[activeDate] || {};

  // Track which saves originated here so we don't flash toast for own updates
  const myPendingSaves = useRef(new Set());
  const toastTimer = useRef(null);

  const showToast = useCallback((message) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, visible: true });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingResetToken = params.get("resetToken");

    if (!incomingResetToken) return;

    const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
    window.history.replaceState(null, "", cleanUrl);

    if (incomingResetToken) {
      setResetToken(incomingResetToken);
      setAuthMode("reset");
      setAuthMessage("Set your new password.");
      setAuthError("");
    }
  }, []);

  // ── Socket.io connection ────────────────────────────────────────────────────
  useEffect(() => {
    // connect if we have a token or we're looking at a public list
    if (!token && !publicListKey) return;

    const socket = io({
      transports: ["websocket", "polling"],
      auth: token ? { token } : undefined,
    });
    socketRef.current = socket;

    if (publicListKey) {
      const subscribe = () => socket.emit("public-list:subscribe", {
        publicId: publicListId || undefined,
        publicSlug: publicListKey,
      });
      socket.on("connect", subscribe);
      if (socket.connected) subscribe();
    }

    socket.on("entry:updated", ({ date, entry }) => {
      // Skip toast if this browser triggered the save
      const isOwn = myPendingSaves.current.has(date);
      if (isOwn) {
        myPendingSaves.current.delete(date);
      } else {
        setEntries(prev => ({ ...prev, [date]: entry }));
        const label = date === today ? "today's entry" : formatDate(date);
        showToast(`✨ ${label} updated by another viewer`);
      }
    });

    socket.on("entry:deleted", ({ date }) => {
      setEntries(prev => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
      if (date !== today) showToast(`🗑 Entry for ${formatDate(date)} was deleted`);
    });

    if (publicListKey) {
      socket.on("public-list:updated", ({ list }) => {
        if (list && (list.publicSlug === publicListKey || (publicListId && list.publicId === publicListId))) {
          if (list.deleted) {
            setPublicList(null);
            showToast("Public list was deleted");
          } else {
            setPublicList(list);
            showToast("Public list updated");
          }
        }
      });
    }

    return () => socket.disconnect();
  }, [today, showToast, token, publicListId, publicListKey]);

  // ── Load all entries on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchAllEntries(authHeaders)
      .then(setEntries)
      .catch((err) => {
        console.error(err);
        if (err.code === 401) setToken("");
      })
      .finally(() => setLoading(false));
  }, [token]);

  // ── Persist to MongoDB ──────────────────────────────────────────────────────
  const persistEntry = useCallback(async (date, data) => {
    setSaveStatus("saving");
    myPendingSaves.current.add(date); // mark as own save
    try {
      await saveEntry(date, data, authHeaders);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      myPendingSaves.current.delete(date);
      if (err.code === 401) {
        setToken("");
        return;
      }
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [authHeaders]);

  // general debounced updater used by most UI interactions
  const saveTimer = useRef(null);
  const updateEntry = useCallback((updates) => {
    const merged = { ...activeEntry, ...updates };
    setEntries(prev => ({ ...prev, [activeDate]: merged }));
    // debounce actual persistence so rapid changes don't spam the server
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persistEntry(activeDate, merged);
    }, 700);
  }, [activeDate, activeEntry, persistEntry]);

  const updateNotes = useCallback((text) => {
    // delegate to the shared updater; it already handles debouncing
    updateEntry({ notes: text });
  }, [updateEntry]);

  // clear pending timeout when component unmounts
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const toggle = (field, val) => {
    const cur = activeEntry[field] || [];
    updateEntry({ [field]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] });
  };
  const toggleObj = (field, key) =>
    updateEntry({ [field]: { ...(activeEntry[field] || {}), [key]: !(activeEntry[field] || {})[key] } });

  const sortedDates = Object.keys(entries).sort().reverse();
  const score = (e) => {
    if (!e) return 0;
    const base =
      (e.medications || []).length + (e.food || []).length +
      Object.values(e.hygiene || {}).filter(Boolean).length +
      Object.values(e.cleaning || {}).filter(Boolean).length;
    const workoutScore = e.workouts ? Object.values(e.workouts).filter(v => v > 0).length : 0;
    return base + workoutScore;
  };
  const maxScore = MEDICATIONS.length + FOODS.length + HYGIENE.length + CLEANING.length + WORKOUTS.length;
  const activeScore = score(activeEntry);
  const scorePct = Math.round((activeScore / maxScore) * 100);

  const inputStyle = { background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: "10px", padding: "8px 12px", color: "var(--input-text)", fontSize: "13px", outline: "none" };
  const textareaStyle = { ...inputStyle, width: "100%", resize: "vertical", lineHeight: 1.6 };
  const themeSelectStyle = {
    background: "var(--surface)",
    color: "var(--header-text)",
    border: "1px solid var(--header-border)",
    borderRadius: "10px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const logout = () => {
    setToken("");
    setActiveDate(today);
    navigateToRoute("", { replace: true });
  };

  // if we're viewing a public list, render it and nothing else
  if (publicListKey) {
    const visiblePublicItems = (publicList?.items || []).filter((it) => !it.done);
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: "40px" }}>
        {publicList ? (
          <div style={{ maxWidth: "500px", margin: "0 auto" }}>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "24px", paddingBottom: "40px" }}>{publicList.name}</h1>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {visiblePublicItems.map((it, idx) => (
                <li key={idx} style={{ marginBottom: "6px" }}>
                  <span style={{ color: it.done ? "var(--muted)" : "var(--text)" }}>{it.text}</span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: "20px", fontSize: "12px", color: "var(--muted)" }}>
              {visiblePublicItems.length === 0 && "(empty list)"}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", marginTop: "80px", color: "var(--muted)" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⏳</div>
          </div>
        )}
      </div>
    );
  }

  // authentication is now part of the home screen; the early return is removed

  if (appView === "home") {
    // home/feature picker, with auth embedded
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: "40px 16px" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <select value={theme} onChange={(e) => setTheme(e.target.value)} style={themeSelectStyle}>
            {THEMES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <h2 style={{ textAlign: "center", fontFamily: "'Playfair Display', serif", color: "var(--heading)" }}>Welcome</h2>

        {!token ? (
          <div style={{ maxWidth: 300, margin: "24px auto", background: "var(--surface)", border: "1px solid var(--border)", padding: 24, borderRadius: 12 }}>
            <h2 style={{ marginBottom: 16, color: "var(--heading)", textAlign: "center" }}>
              {authMode === "login" && "Sign In"}
              {authMode === "register" && "Register"}
              {authMode === "forgot" && "Reset Password"}
              {authMode === "reset" && "Choose New Password"}
            </h2>
            <AuthForm
              mode={authMode}
              onSubmit={async ({ email, password, confirmPassword }) => {
                setAuthError("");
                setAuthMessage("");
                try {
                  if (authMode === "login") {
                    const { token } = await doLogin(email, password);
                    setToken(token);
                  } else if (authMode === "register") {
                    await doRegister(email, password);
                    setAuthMode("login");
                    setAuthMessage("Account created. You can sign in now.");
                  } else if (authMode === "forgot") {
                    await doRequestPasswordReset(email);
                    setAuthMode("login");
                    setAuthMessage("If that email exists, a reset link has been sent.");
                  } else if (authMode === "reset") {
                    if (!resetToken) throw new Error("Missing reset token");
                    if (password !== confirmPassword) throw new Error("Passwords do not match");
                    await doConfirmPasswordReset(resetToken, password);
                    setResetToken("");
                    setAuthMode("login");
                    setAuthMessage("Password updated. Sign in with your new password.");
                  }
                } catch (e) {
                  setAuthError(e.message);
                }
              }}
            />
            <div style={{ marginTop: 12, textAlign: "center" }}>
              {authMode === "login" && (
                <>
                  <button onClick={() => { setAuthMode("register"); setAuthError(""); setAuthMessage(""); }} style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", marginRight: "10px" }}>
                    Need an account?
                  </button>
                  <button onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthMessage(""); }} style={{ background: "none", border: "none", color: "var(--accent-warn)", cursor: "pointer" }}>
                    Forgot password?
                  </button>
                </>
              )}
              {authMode === "register" && (
                <button onClick={() => { setAuthMode("login"); setAuthError(""); setAuthMessage(""); }} style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer" }}>
                  Have an account?
                </button>
              )}
              {authMode === "forgot" && (
                <button onClick={() => { setAuthMode("login"); setAuthError(""); setAuthMessage(""); }} style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer" }}>
                  Back to sign in
                </button>
              )}
              {authMode === "reset" && (
                <button onClick={() => { setAuthMode("login"); setResetToken(""); setAuthError(""); setAuthMessage(""); }} style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer" }}>
                  Back to sign in
                </button>
              )}
            </div>
            {authError && <div style={{ color: "var(--error)", marginTop: 8, fontSize: 13, textAlign: "center" }}>{authError}</div>}
            {authMessage && <div style={{ color: "var(--accent-primary)", marginTop: 8, fontSize: 13, textAlign: "center" }}>{authMessage}</div>}
          </div>
        ) : (
          <>
            <div style={{ maxWidth: "680px", margin: "24px auto", display: "grid", gap: "16px" }}>
              {FEATURES.map(f => (
                <button
                  key={f.key}
                  onClick={() => {
                    navigateToRoute(f.key);
                    if (f.key === "journal") setActiveDate(today);
                  }}
                  style={{ padding: "16px", borderRadius: "12px", background: "var(--surface-soft)", border: "1px solid var(--ring)", color: "var(--heading)", fontSize: "16px", cursor: "pointer" }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: "40px" }}>
              <button onClick={logout} style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer" }}>
                Log out
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (appView !== "journal" && appView !== "lists") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: "40px", textAlign: "center" }}>
        <h2 style={{ color: "var(--heading)" }}>Feature "{appView}" not available yet</h2>
        <button onClick={() => navigateToRoute("")} style={{ marginTop: "24px", padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--ring)", background: "var(--surface-soft)", color: "var(--heading)", cursor: "pointer" }}>
          ← Back to home
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <style>{`
        @keyframes pulse {
          0%,100% { opacity:1; }
          50%      { opacity:0.4; }
        }
      `}</style>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,var(--header-grad-start) 0%,var(--header-grad-end) 100%)", borderBottom: "1px solid var(--header-border)", padding: "20px 24px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: "680px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {appView === "home" ? (
                  <h1 style={{ margin: 0, fontSize: "22px", fontFamily: "'Playfair Display', serif", fontWeight: 700, color: "var(--header-text)" }}>
                    Notebook
                  </h1>
                ) : (
                  <>
                    <button
                      onClick={() => { navigateToRoute(""); setView("today"); setActiveDate(today); }}
                      style={{ background: "none", border: "none", color: "var(--header-text)", cursor: "pointer", fontSize: "14px", padding: 0 }}
                    >
                      Home
                    </button>
                    <span style={{ color: "var(--header-text)", fontSize: "14px" }}>/</span>
                    {isListEditor ? (
                      <>
                        <button
                          onClick={() => navigateToRoute("lists")}
                          style={{ background: "none", border: "none", color: "var(--header-text)", cursor: "pointer", fontSize: "14px", padding: 0 }}
                        >
                          Lists
                        </button>
                        <span style={{ color: "var(--header-text)", fontSize: "14px" }}>/</span>
                        <h1 style={{ margin: 0, fontSize: "14px", fontFamily: "'Playfair Display', serif", fontWeight: 700, color: "var(--header-text)" }}>
                          {selectedListTitle || "List Editor"}
                        </h1>
                      </>
                    ) : (
                      <h1 style={{ margin: 0, fontSize: "14px", fontFamily: "'Playfair Display', serif", fontWeight: 700, color: "var(--header-text)" }}>
                        {featureTitle || "Notebook"}
                      </h1>
                    )}
                  </>
                )}
                <SaveIndicator status={saveStatus} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              {appView === "journal" && (
                <>
                  {["today", "history", "chart"].map(v => (
                    <button key={v} onClick={() => setView(v)} style={{ padding: "7px 16px", borderRadius: "10px", border: view === v ? "1px solid var(--header-btn-border)" : "1px solid var(--header-border)", background: view === v ? "var(--header-btn-bg)" : "transparent", color: "var(--header-btn-text)", cursor: "pointer", fontSize: "13px", fontWeight: 500, textTransform: "capitalize" }}>
                      {JOURNAL_VIEW_LABELS[v] || v}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "20px 16px 80px" }}>
        {appView === "lists" ? (
          <Lists
            token={token}
            socket={socketRef.current}
            selectedId={selectedListIdRoute}
            onSelectedListTitle={setSelectedListTitle}
            onSelectList={(id) => navigateToRoute(`lists/edit/${encodeURIComponent(id)}`)}
            onCloseList={() => navigateToRoute("lists")}
          />
        ) : loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--muted)" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📓</div>
            <div>Loading your journal…</div>
          </div>
        ) : view === "today" ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", fontSize: "13px", color: "var(--muted-strong)" }}>
              <span>{activeDateLabel}</span>
              {activeDate !== today && (
                <button
                  onClick={() => setActiveDate(today)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--heading)",
                    cursor: "pointer",
                    fontSize: "12px",
                    padding: 0,
                  }}
                >
                  Today
                </button>
              )}
            </div>
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--heading)", marginBottom: "4px" }}>
                <span>Wellness score</span>
                <span style={{ color: "var(--heading)", fontWeight: 600 }}>{scorePct}%</span>
              </div>
              <ScoreBar score={activeScore} max={maxScore} color={scorePct > 60 ? "var(--accent-primary)" : scorePct > 30 ? "var(--accent-warn)" : "var(--ring)"} />
            </div>
            <Section title="How are you feeling?" icon="💭" accent="var(--heading)">
              <MoodSelector value={activeEntry.mood || null} onChange={v => updateEntry({ mood: v })} />

            </Section>

            <Section title="Medication" icon="💊" accent="var(--accent-med)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[...MEDICATIONS, ...(activeEntry.customMeds || [])].map(med => (
                  <ToggleChip key={med} label={med} emoji="💊" checked={(activeEntry.medications || []).includes(med)} onChange={() => toggle("medications", med)} color="var(--accent-med)" />
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <input spellCheck={true} value={customMedInput} onChange={e => setCustomMedInput(e.target.value)} placeholder="+ add custom medication…" style={{ ...inputStyle, flex: 1 }}
                  onKeyDown={e => { if (e.key === "Enter" && customMedInput.trim()) { const l = customMedInput.trim(); updateEntry({ customMeds: [...(activeEntry.customMeds || []), l], medications: [...(activeEntry.medications || []), l] }); setCustomMedInput(""); } }}
                />
                <button onClick={() => { if (customMedInput.trim()) { const l = customMedInput.trim(); updateEntry({ customMeds: [...(activeEntry.customMeds || []), l], medications: [...(activeEntry.medications || []), l] }); setCustomMedInput(""); } }}
                  style={{ padding: "8px 16px", borderRadius: "10px", border: "1px solid var(--accent-med)", background: "var(--accent-med-soft)", color: "var(--accent-med)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                  Add
                </button>
              </div>
            </Section>


            <Section title="Blood Pressure" icon="🩺" accent="var(--muted)">
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>Systolic</label>
                  <input
                    type="number"
                    min="0"
                    value={activeEntry.systolic || ""}
                    onChange={e => updateEntry({ systolic: parseInt(e.target.value) || null })}
                    style={{ ...inputStyle, width: "80px", textAlign: "center" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>Diastolic</label>
                  <input
                    type="number"
                    min="0"
                    value={activeEntry.diastolic || ""}
                    onChange={e => updateEntry({ diastolic: parseInt(e.target.value) || null })}
                    style={{ ...inputStyle, width: "80px", textAlign: "center" }}
                  />
                </div>
              </div>
            </Section>


            <Section title="Nutrition" icon="🥗" accent="var(--accent-food)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                {FOODS.map(f => <ToggleChip key={f.label} label={f.label} emoji={f.emoji} checked={(activeEntry.food || []).includes(f.label)} onChange={() => toggle("food", f.label)} color="var(--accent-food)" />)}
              </div>
              <textarea spellCheck={true} placeholder={`What did you eat ${activeDatePromptTarget}?`} value={activeEntry.food_notes || ""} onChange={e => updateEntry({ food_notes: e.target.value })} style={{ ...textareaStyle, minHeight: "70px", padding: "10px 12px" }} />
            </Section>

            <Section title="Personal Hygiene" icon="🚿" accent="var(--accent-hygiene)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {HYGIENE.map(h => <ToggleChip key={h.key} label={h.label} emoji={h.emoji} checked={!!(activeEntry.hygiene || {})[h.key]} onChange={() => toggleObj("hygiene", h.key)} color="var(--accent-hygiene)" />)}
              </div>
            </Section>

            <Section title="House Cleaning" icon="🏠" accent="var(--accent-clean)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {CLEANING.map(c => <ToggleChip key={c.key} label={c.label} emoji={c.emoji} checked={!!(activeEntry.cleaning || {})[c.key]} onChange={() => toggleObj("cleaning", c.key)} color="var(--accent-clean)" />)}
              </div>
            </Section>

            <Section title="Workouts" icon="🏋️" accent="var(--accent-workout)">
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                {WORKOUTS.map(w => (
                  <div key={w.key} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: "13px", color: "var(--muted-strong)" }}>{w.emoji}</span>
                    <input
                      type="number"
                      min="0"
                      value={(activeEntry.workouts || {})[w.key] || 0}
                      onChange={e => updateEntry({
                        workouts: {
                          ...(activeEntry.workouts || {}),
                          [w.key]: parseInt(e.target.value) || 0,
                        }
                      })}
                      style={{ ...inputStyle, width: "60px", textAlign: "center" }}
                    />
                    <span style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>{w.label}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Journal Notes" icon="📝" accent="var(--accent-note)">
              <textarea spellCheck={true} placeholder={`How did ${activeDatePromptTarget} go? Anything on your mind…`} value={activeEntry.notes || ""} onChange={e => updateNotes(e.target.value)} style={{ ...textareaStyle, minHeight: "120px", padding: "12px", fontSize: "14px" }} />
            </Section>

            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {[
                { label: "Medications taken", val: (activeEntry.medications || []).length, max: MEDICATIONS.length, color: "var(--accent-med)" },
                { label: "Meals logged", val: (activeEntry.food || []).length, max: FOODS.length, color: "var(--accent-food)" },
                { label: "Hygiene tasks", val: Object.values(activeEntry.hygiene || {}).filter(Boolean).length, max: HYGIENE.length, color: "var(--accent-hygiene)" },
                { label: "Cleaning tasks", val: Object.values(activeEntry.cleaning || {}).filter(Boolean).length, max: CLEANING.length, color: "var(--accent-clean)" },
                { label: "Workouts done", val: activeEntry.workouts ? Object.values(activeEntry.workouts).filter(v => v > 0).length : 0, max: WORKOUTS.length, color: "var(--accent-workout)" },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--muted)" }}>
                    <span>{s.label}</span><span style={{ color: s.color, fontWeight: 600 }}>{s.val}/{s.max}</span>
                  </div>
                  <ScoreBar score={s.val} max={s.max} color={s.color} />
                </div>
              ))}
            </div>
          </>
        ) : view === "chart" ? (
          <>
            <BpChart entries={entries} />
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "var(--heading)", marginBottom: "20px" }}>Workout Trends</h2>
            <WorkoutChart entries={entries} />
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "var(--heading)" }}>Past Entries</h2>
              <span style={{ color: "var(--muted-strong)", fontSize: "13px" }}>{sortedDates.length} day{sortedDates.length !== 1 ? "s" : ""} logged</span>
            </div>
            {sortedDates.length === 0
              ? <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)", fontStyle: "italic" }}>No entries yet. Start tracking today!</div>
              : sortedDates.map(date => (
                <div
                  key={date}
                  style={{
                    position: "relative",
                    border: date === activeDate ? "2px solid var(--accent-primary)" : undefined,
                    borderRadius: "14px",
                  }}
                >
                  <EntryView
                    date={date}
                    entry={entries[date]}
                    onEdit={(d) => { setActiveDate(d); setView("today"); }}
                  />
                </div>
              ))
            }
          </>
        )}
      </div>

      {/* Toast for remote updates */}
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}
