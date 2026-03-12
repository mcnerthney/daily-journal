import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";

import {
  API,
  getTodayKey,
  formatDate,
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
import LivePill from "./components/LivePill";
import Toast from "./components/Toast";
import SaveIndicator from "./components/SaveIndicator";
import AuthForm from "./components/AuthForm";
import WorkoutChart from "./components/WorkoutChart";
import BpChart from "./components/BpChart";
import Lists from "./components/Lists";

// list of top‑level features that can appear on the home screen
const FEATURES = [
  { key: "journal", label: "Daily Journal", emoji: "📝" },
  { key: "lists", label: "Lists", emoji: "📋" },
  // additional features can be added here later
];

// auth helper methods
async function doLogin(email, password) {
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("login failed");
  return res.json(); // { token }
}

async function doRegister(email, password) {
  const res = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("register failed");
  return res.json();
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [view, setView] = useState("today");
  // top‑level view: home menu vs. journal feature
  const [appView, setAppView] = useState("home");
  const [publicListId, setPublicListId] = useState(null);
  const [publicList, setPublicList] = useState(null);

  // derive feature metadata from the list
  const currentFeature = FEATURES.find(f => f.key === appView);
  const featureTitle = currentFeature ? currentFeature.label : "";

  // which date are we currently editing? defaults to today but can be changed
  const currentDate = getTodayKey();
  const [activeDate, setActiveDate] = useState(currentDate);

  // --- handle public list routes ------------------------------------------------
  useEffect(() => {
    const match = window.location.pathname.match(/^\/lists\/public\/([^\/]+)/);
    if (match) {
      const id = match[1];
      setPublicListId(id);
      fetchPublicList(id)
        .then(setPublicList)
        .catch(() => setPublicList(null));
    }
  }, []);

  // --- sync appView with URL hash ------------------------------------------------
  // when component mounts or hash changes, update state if it matches a feature

  const routes = {
    home: () => setAppView("home"),
    journal: () => {
      setAppView("journal");
      setView("today");
    },
    stats: () => setAppView("stats")
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = location.hash.replace("#", "") || "home";
      routes[hash]?.();
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = location.hash.replace("#", "") || "home";
      if (!FEATURES.some(f => f.key === hash)) return;

      setAppView(hash);
      if (hash === "journal") setView("today");
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // reflect state in the hash when appView changes
  useEffect(() => {
    if (appView === "home") {
      // remove hash while preserving path
      history.replaceState(null, "", window.location.pathname);
    } else {
      if (window.location.hash !== appView) {
        window.location.hash = appView;
      }
    }
  }, [appView]);

  // keep localStorage in sync
  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("token");
    }
  }, [token]);
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [customMedInput, setCustomMedInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [authMode, setAuthMode] = useState("login"); // or register
  const [authError, setAuthError] = useState("");
  const [viewers, setViewers] = useState(1);
  const [toast, setToast] = useState({ message: "", visible: false });
  // keep a constant for the real "today" so we can label toasts appropriately
  const today = currentDate;
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

  // ── Socket.io connection ────────────────────────────────────────────────────
  useEffect(() => {
    // connect if we have a token or we're looking at a public list
    if (!token && !publicListId) return;

    const socket = io({
      transports: ["websocket", "polling"],
      auth: token ? { token } : undefined,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("presence", ({ count }) => setViewers(count));

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

    if (publicListId) {
      socket.on("public-list:updated", ({ list }) => {
        if (list && list._id === publicListId) {
          setPublicList(list);
          showToast("Public list updated");
        }
      });
    }

    return () => socket.disconnect();
  }, [today, showToast, token, publicListId]);

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

  const inputStyle = { background: "#0e0e16", border: "1px solid #2a2a3a", borderRadius: "10px", padding: "8px 12px", color: "#e8e8f0", fontSize: "13px", outline: "none" };
  const textareaStyle = { ...inputStyle, width: "100%", resize: "vertical", lineHeight: 1.6 };

  // ── Render ──────────────────────────────────────────────────────────────────
  const logout = () => {
    setToken("");
    setAppView("home");
    setActiveDate(today);
  };

  // if we're viewing a public list, render it and nothing else
  if (publicListId) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a10", color: "#e8e8f0", padding: "40px" }}>
        {publicList ? (
          <div style={{ maxWidth: "500px", margin: "0 auto" }}>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "24px" }}>{publicList.name}</h1>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {(publicList.items || []).map((it, idx) => (
                <li key={idx} style={{ marginBottom: "6px" }}>
                  <span style={{ color: it.done ? "#888" : "#e8e8f0" }}>{it.text}</span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: "20px", fontSize: "12px", color: "#888" }}>
              {publicList.items && publicList.items.length === 0 && "(empty list)"}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", marginTop: "80px", color: "#555" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📋</div>
            <div>List not found.</div>
          </div>
        )}
      </div>
    );
  }

  // authentication is now part of the home screen; the early return is removed

  if (appView === "home") {
    // home/feature picker, with auth embedded
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a10", color: "#e8e8f0", padding: "40px 16px" }}>
        <h2 style={{ textAlign: "center", fontFamily: "'Playfair Display', serif", color: "#c9b8ff" }}>Welcome</h2>

        {!token ? (
          <div style={{ maxWidth: 300, margin: "24px auto", background: "#12121a", padding: 24, borderRadius: 12 }}>
            <h2 style={{ marginBottom: 16, color: "#c9b8ff", textAlign: "center" }}>{authMode === "login" ? "Sign In" : "Register"}</h2>
            <AuthForm
              mode={authMode}
              onSubmit={async (email, pass) => {
                setAuthError("");
                try {
                  if (authMode === "login") {
                    const { token } = await doLogin(email, pass);
                    setToken(token);
                  } else {
                    await doRegister(email, pass);
                    setAuthMode("login");
                  }
                } catch (e) {
                  setAuthError(e.message);
                }
              }}
            />
            <div style={{ marginTop: 12, textAlign: "center" }}>
              {authMode === "login" ? (
                <button onClick={() => setAuthMode("register")} style={{ background: "none", border: "none", color: "#4ade80", cursor: "pointer" }}>
                  Need an account?
                </button>
              ) : (
                <button onClick={() => setAuthMode("login")} style={{ background: "none", border: "none", color: "#4ade80", cursor: "pointer" }}>
                  Have an account?
                </button>
              )}
            </div>
            {authError && <div style={{ color: "#ef4444", marginTop: 8, fontSize: 13, textAlign: "center" }}>{authError}</div>}
          </div>
        ) : (
          <>
            <div style={{ maxWidth: "680px", margin: "24px auto", display: "grid", gap: "16px" }}>
              {FEATURES.map(f => (
                <button
                  key={f.key}
                  onClick={() => {
                    setAppView(f.key);
                    if (f.key === "journal") {
                      setView("today");
                      setActiveDate(today);
                    }
                  }}
                  style={{ padding: "16px", borderRadius: "12px", background: "#6d5acd22", border: "1px solid #6d5acd", color: "#c9b8ff", fontSize: "16px", cursor: "pointer" }}
                >
                  {f.emoji} {f.label}
                </button>
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: "40px" }}>
              <button onClick={logout} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>
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
      <div style={{ minHeight: "100vh", background: "#0a0a10", color: "#e8e8f0", padding: "40px", textAlign: "center" }}>
        <h2 style={{ color: "#c9b8ff" }}>Feature "{appView}" not available yet</h2>
        <button onClick={() => setAppView("home")} style={{ marginTop: "24px", padding: "8px 16px", borderRadius: "8px", border: "1px solid #6d5acd", background: "#6d5acd22", color: "#c9b8ff", cursor: "pointer" }}>
          ← Back to home
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a10", color: "#e8e8f0" }}>
      <style>{`
        @keyframes pulse {
          0%,100% { opacity:1; }
          50%      { opacity:0.4; }
        }
      `}</style>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#12121e 0%,#1a1228 100%)", borderBottom: "1px solid #2a2a3a", padding: "20px 24px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: "680px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                {appView !== "home" && (
                  <button
                    onClick={() => { setAppView("home"); setView("today"); setActiveDate(today); }}
                    style={{ background: "none", border: "none", color: "#4ade80", cursor: "pointer", fontSize: "14px" }}
                  >
                    ← Home
                  </button>
                )}
                <h1 style={{ margin: 0, fontSize: "22px", fontFamily: "'Playfair Display', serif", fontWeight: 700, background: "linear-gradient(135deg,#c9b8ff,#f0acd4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  {featureTitle || "Daily Journal"}
                </h1>
                <LivePill connected={connected} viewers={viewers} />
                <SaveIndicator status={saveStatus} />
              </div>
              <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                {formatDate(activeDate)}
                {activeDate !== today && (
                  <button
                    onClick={() => setActiveDate(today)}
                    style={{
                      marginLeft: "8px",
                      background: "none",
                      border: "none",
                      color: "#4ade80",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    Today
                  </button>
                )}
              </div>
            </div>
            {appView === "journal" && (
              <div style={{ display: "flex", gap: "8px" }}>
                {["today", "history", "chart"].map(v => (
                  <button key={v} onClick={() => setView(v)} style={{ padding: "7px 16px", borderRadius: "10px", border: view === v ? "1px solid #6d5acd" : "1px solid #2a2a3a", background: view === v ? "#6d5acd22" : "transparent", color: view === v ? "#c9b8ff" : "#666", cursor: "pointer", fontSize: "13px", fontWeight: 500, textTransform: "capitalize" }}>
                    {v === "chart" ? "Stats" : v}
                  </button>
                ))}
              </div>
            )}
            <button onClick={logout} style={{ marginLeft: "12px", padding: "7px 16px", borderRadius: "10px", border: "1px solid #ef4444", background: "#ef444422", color: "#ef4444", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}>
              Log out
            </button>
          </div>
          {appView === "journal" && view === "today" && (
            <div style={{ marginTop: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#888", marginBottom: "4px" }}>
                <span>{activeDate === today ? "Today's wellness score" : formatDate(activeDate) + " wellness score"}</span>
                <span style={{ color: scorePct > 60 ? "#22c55e" : scorePct > 30 ? "#eab308" : "#ef4444", fontWeight: 600 }}>{scorePct}%</span>
              </div>
              <ScoreBar score={activeScore} max={maxScore} color={scorePct > 60 ? "#22c55e" : scorePct > 30 ? "#eab308" : "#6d5acd"} />
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "20px 16px 80px" }}>
        {appView === "lists" ? (
          <Lists token={token} socket={socketRef.current} />
        ) : loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#555" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📓</div>
            <div>Loading your journal…</div>
          </div>
        ) : view === "today" ? (
          <>
            <Section title="How are you feeling?" icon="💭" accent="#c9b8ff">
              <MoodSelector value={activeEntry.mood || null} onChange={v => updateEntry({ mood: v })} />

            </Section>

            <Section title="Medication" icon="💊" accent="#fb923c">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[...MEDICATIONS, ...(activeEntry.customMeds || [])].map(med => (
                  <ToggleChip key={med} label={med} emoji="💊" checked={(activeEntry.medications || []).includes(med)} onChange={() => toggle("medications", med)} color="#fb923c" />
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <input spellCheck={true} value={customMedInput} onChange={e => setCustomMedInput(e.target.value)} placeholder="+ add custom medication…" style={{ ...inputStyle, flex: 1 }}
                  onKeyDown={e => { if (e.key === "Enter" && customMedInput.trim()) { const l = customMedInput.trim(); updateEntry({ customMeds: [...(activeEntry.customMeds || []), l], medications: [...(activeEntry.medications || []), l] }); setCustomMedInput(""); } }}
                />
                <button onClick={() => { if (customMedInput.trim()) { const l = customMedInput.trim(); updateEntry({ customMeds: [...(activeEntry.customMeds || []), l], medications: [...(activeEntry.medications || []), l] }); setCustomMedInput(""); } }}
                  style={{ padding: "8px 16px", borderRadius: "10px", border: "1px solid #fb923c", background: "#fb923c22", color: "#fb923c", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                  Add
                </button>
              </div>
            </Section>


            <Section title="Blood Pressure" icon="🩺" accent="#f472b6">
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Systolic</label>
                  <input
                    type="number"
                    min="0"
                    value={activeEntry.systolic || ""}
                    onChange={e => updateEntry({ systolic: parseInt(e.target.value) || null })}
                    style={{ ...inputStyle, width: "80px", textAlign: "center" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Diastolic</label>
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


            <Section title="Nutrition" icon="🥗" accent="#4ade80">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                {FOODS.map(f => <ToggleChip key={f.label} label={f.label} emoji={f.emoji} checked={(activeEntry.food || []).includes(f.label)} onChange={() => toggle("food", f.label)} color="#4ade80" />)}
              </div>
              <textarea spellCheck={true} placeholder="What did you eat today?" value={activeEntry.food_notes || ""} onChange={e => updateEntry({ food_notes: e.target.value })} style={{ ...textareaStyle, minHeight: "70px", padding: "10px 12px" }} />
            </Section>

            <Section title="Personal Hygiene" icon="🚿" accent="#38bdf8">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {HYGIENE.map(h => <ToggleChip key={h.key} label={h.label} emoji={h.emoji} checked={!!(activeEntry.hygiene || {})[h.key]} onChange={() => toggleObj("hygiene", h.key)} color="#38bdf8" />)}
              </div>
            </Section>

            <Section title="House Cleaning" icon="🏠" accent="#f472b6">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {CLEANING.map(c => <ToggleChip key={c.key} label={c.label} emoji={c.emoji} checked={!!(activeEntry.cleaning || {})[c.key]} onChange={() => toggleObj("cleaning", c.key)} color="#f472b6" />)}
              </div>
            </Section>

            <Section title="Workouts" icon="🏋️" accent="#fcd34d">
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                {WORKOUTS.map(w => (
                  <div key={w.key} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: "13px", color: "#ccc" }}>{w.emoji}</span>
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
                    <span style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>{w.label}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Journal Notes" icon="📝" accent="#a78bfa">
              <textarea spellCheck={true} placeholder="How was your day? Anything on your mind…" value={activeEntry.notes || ""} onChange={e => updateNotes(e.target.value)} style={{ ...textareaStyle, minHeight: "120px", padding: "12px", fontSize: "14px" }} />
            </Section>

            <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: "16px", padding: "18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {[
                { label: "Medications taken", val: (activeEntry.medications || []).length, max: MEDICATIONS.length, color: "#fb923c" },
                { label: "Meals logged", val: (activeEntry.food || []).length, max: FOODS.length, color: "#4ade80" },
                { label: "Hygiene tasks", val: Object.values(activeEntry.hygiene || {}).filter(Boolean).length, max: HYGIENE.length, color: "#38bdf8" },
                { label: "Cleaning tasks", val: Object.values(activeEntry.cleaning || {}).filter(Boolean).length, max: CLEANING.length, color: "#f472b6" },
                { label: "Workouts done", val: activeEntry.workouts ? Object.values(activeEntry.workouts).filter(v => v > 0).length : 0, max: WORKOUTS.length, color: "#fcd34d" },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#888" }}>
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
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#c9b8ff", marginBottom: "20px" }}>Workout Trends</h2>
            <WorkoutChart entries={entries} />
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#c9b8ff" }}>Past Entries</h2>
              <span style={{ color: "#666", fontSize: "13px" }}>{sortedDates.length} day{sortedDates.length !== 1 ? "s" : ""} logged</span>
            </div>
            {sortedDates.length === 0
              ? <div style={{ textAlign: "center", padding: "60px 20px", color: "#555", fontStyle: "italic" }}>No entries yet. Start tracking today!</div>
              : sortedDates.map(date => (
                <div
                  key={date}
                  style={{
                    position: "relative",
                    border: date === activeDate ? "2px solid #4ade80" : undefined,
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
