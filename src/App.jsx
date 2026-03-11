import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";

const API = "/api";

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

const MOODS = [
  { label: "Awful", emoji: "😞", color: "#ef4444", value: 1 },
  { label: "Bad", emoji: "😕", color: "#f97316", value: 2 },
  { label: "Meh", emoji: "😐", color: "#eab308", value: 3 },
  { label: "Good", emoji: "🙂", color: "#84cc16", value: 4 },
  { label: "Great", emoji: "😄", color: "#22c55e", value: 5 },
];

const MEDICATIONS = ["Morning meds", "Evening meds", "Vitamins", "Supplements", "PRN / As needed"];
const FOODS = [
  { label: "Breakfast", emoji: "🌅" }, { label: "Lunch", emoji: "☀️" },
  { label: "Dinner", emoji: "🌙" }, { label: "Snacks", emoji: "🍎" },
  { label: "Water (8+ glasses)", emoji: "💧" }, { label: "No alcohol", emoji: "🚫🍺" },
];
const HYGIENE = [
  { label: "Brushed teeth (AM)", emoji: "🪥", key: "teeth_am" },
  { label: "Brushed teeth (PM)", emoji: "🌙", key: "teeth_pm" },
  { label: "Bath / Shower", emoji: "🚿", key: "bath" },
  { label: "Skincare", emoji: "✨", key: "skincare" },
];
const CLEANING = [
  { label: "Dishes", emoji: "🍽️", key: "dishes" },
  { label: "Surfaces / Counters", emoji: "🧹", key: "surfaces" },
  { label: "Laundry", emoji: "👕", key: "laundry" },
  { label: "Vacuum / Sweep", emoji: "🌀", key: "vacuum" },
  { label: "Trash", emoji: "🗑️", key: "trash" },
  { label: "Bathroom clean", emoji: "🪣", key: "bathroom_clean" },
];

// workout types tracked in the journal
const WORKOUTS = [
  { key: "pullups", label: "Pull‑ups", emoji: "💪" },
  { key: "squats", label: "Squats", emoji: "🏋️" },
  { key: "pushups", label: "Push‑ups", emoji: "🤸" },
];

const getTodayKey = () =>
  new Date().toLocaleDateString("en-CA");

const formatDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
});

const fetchAllEntries = async (headers = {}) => {
  const res = await fetch(`${API}/entries`, { headers });
  if (!res.ok) {
    const err = new Error("fetch failed");
    if (res.status === 401) err.code = 401;
    throw err;
  }
  return res.json();
};
const saveEntry = async (date, data, headers = {}) => {
  const res = await fetch(`${API}/entries/${date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = new Error("save failed");
    if (res.status === 401) err.code = 401;
    throw err;
  }
};

// ── UI primitives ─────────────────────────────────────────────────────────────

function ToggleChip({ label, emoji, checked, onChange, color }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px",
      borderRadius: "20px",
      border: checked ? `2px solid ${color || "#6d5acd"}` : "2px solid #2a2a3a",
      background: checked ? (color ? color + "22" : "#6d5acd22") : "#16161f",
      color: checked ? (color || "#b8aef0") : "#666",
      cursor: "pointer", fontSize: "13px", fontWeight: checked ? 600 : 400,
      transition: "all 0.15s ease", userSelect: "none",
    }}>
      {emoji && <span style={{ fontSize: "15px" }}>{emoji}</span>}
      {label}
    </button>
  );
}

function Section({ title, icon, children, accent }) {
  return (
    <div style={{ background: "#12121a", border: `1px solid ${accent || "#2a2a3a"}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <span style={{ fontSize: "20px" }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: "15px", fontFamily: "'Playfair Display', serif", fontWeight: 600, color: accent || "#c9b8ff", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function MoodSelector({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
      {MOODS.map((m) => (
        <button key={m.value} onClick={() => onChange(value === m.value ? null : m.value)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
          padding: "12px 16px", borderRadius: "14px",
          border: value === m.value ? `2px solid ${m.color}` : "2px solid #2a2a3a",
          background: value === m.value ? m.color + "22" : "#16161f",
          cursor: "pointer", transition: "all 0.15s ease", minWidth: "60px",
          transform: value === m.value ? "scale(1.08)" : "scale(1)",
        }}>
          <span style={{ fontSize: "26px" }}>{m.emoji}</span>
          <span style={{ fontSize: "11px", color: value === m.value ? m.color : "#555", fontWeight: 500 }}>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

function ScoreBar({ score, max, color }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div style={{ height: "6px", background: "#2a2a3a", borderRadius: "3px", overflow: "hidden", marginTop: "6px" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color || "#6d5acd", borderRadius: "3px", transition: "width 0.4s ease" }} />
    </div>
  );
}

function EntryView({ entry, date }) {
  const mood = MOODS.find((m) => m.value === entry.mood);
  const counts = [
    { label: `💊 ${(entry.medications || []).length}`, active: (entry.medications || []).length > 0 },
    { label: `🥗 ${(entry.food || []).length}`, active: (entry.food || []).length > 0 },
    { label: `🚿 ${Object.values(entry.hygiene || {}).filter(Boolean).length}`, active: Object.values(entry.hygiene || {}).some(Boolean) },
    { label: `🏠 ${Object.values(entry.cleaning || {}).filter(Boolean).length}`, active: Object.values(entry.cleaning || {}).some(Boolean) },
    { label: `🏋️ ${entry.workouts ? Object.values(entry.workouts).filter(v => v > 0).length : 0}`, active: entry.workouts && Object.values(entry.workouts).some(v => v > 0) },
  ];
  return (
    <div style={{ background: "#0e0e16", border: "1px solid #2a2a3a", borderRadius: "14px", padding: "18px", marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
        <div>
          <div style={{ fontSize: "13px", color: "#888", marginBottom: "4px" }}>{formatDate(date)}</div>
          {mood && <div style={{ display: "flex", alignItems: "center", gap: "6px", color: mood.color, fontWeight: 600, fontSize: "14px" }}><span style={{ fontSize: "18px" }}>{mood.emoji}</span>{mood.label}</div>}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {counts.map((b, i) => (
            <span key={i} style={{ padding: "3px 10px", borderRadius: "10px", background: b.active ? "#6d5acd22" : "#1a1a26", color: b.active ? "#c9b8ff" : "#444", fontSize: "12px" }}>{b.label}</span>
          ))}
        </div>
      </div>
      {entry.food_notes && <p style={{ margin: 0, color: "#aaa", fontSize: "13px", lineHeight: 1.6, fontStyle: "italic", borderTop: "1px solid #2a2a3a", paddingTop: "10px" }}>{entry.food_notes}</p>}
      {entry.workouts && Object.values(entry.workouts).some(v => v > 0) && (
        <div style={{ marginTop: "8px", color: "#ddd", fontSize: "13px" }}>
          {WORKOUTS.map(w => {
            const val = entry.workouts && entry.workouts[w.key];
            return val > 0 ? <div key={w.key}>{w.emoji} {w.label}: {val}</div> : null;
          })}
        </div>
      )}

      {entry.notes && <p style={{ margin: 0, color: "#aaa", fontSize: "13px", lineHeight: 1.6, fontStyle: "italic", borderTop: "1px solid #2a2a3a", paddingTop: "10px" }}>{entry.notes}</p>}
    </div>
  );
}

// Live indicator pill
function LivePill({ connected, viewers }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "4px 10px", borderRadius: "20px",
      background: connected ? "#0d2d1a" : "#2a1a1a",
      border: `1px solid ${connected ? "#22c55e44" : "#ef444444"}`,
      fontSize: "12px",
      color: connected ? "#4ade80" : "#f87171",
      transition: "all 0.3s",
    }}>
      <span style={{
        width: "7px", height: "7px", borderRadius: "50%",
        background: connected ? "#22c55e" : "#ef4444",
        boxShadow: connected ? "0 0 6px #22c55e" : "none",
        animation: connected ? "pulse 2s infinite" : "none",
        flexShrink: 0,
      }} />
      {connected ? `${viewers} viewer${viewers !== 1 ? "s" : ""} live` : "Reconnecting…"}
    </div>
  );
}

// Toast notification for remote updates
function Toast({ message, visible }) {
  return (
    <div style={{
      position: "fixed", bottom: "24px", left: "50%", transform: `translateX(-50%) translateY(${visible ? 0 : "80px"})`,
      background: "#1e1e2e", border: "1px solid #6d5acd", borderRadius: "12px",
      padding: "10px 18px", fontSize: "13px", color: "#c9b8ff",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      transition: "transform 0.3s ease, opacity 0.3s ease",
      opacity: visible ? 1 : 0, zIndex: 999, whiteSpace: "nowrap",
      pointerEvents: "none",
    }}>
      {message}
    </div>
  );
}

function SaveIndicator({ status }) {
  const map = {
    idle: { text: "", color: "transparent" },
    saving: { text: "Saving…", color: "#eab308" },
    saved: { text: "✓ Saved", color: "#22c55e" },
    error: { text: "Save failed", color: "#ef4444" },
  };
  const s = map[status] || map.idle;
  return <span style={{ fontSize: "12px", color: s.color, transition: "color 0.3s", marginLeft: "12px" }}>{s.text}</span>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [view, setView] = useState("today");

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
  const today = getTodayKey();

  // headers helper including auth token
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const todayEntry = entries[today] || {};

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
    if (!token) return; const socket = io({
      transports: ["websocket", "polling"],
      auth: { token },
    });

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

    return () => socket.disconnect();
  }, [today, showToast, token]);

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
    const merged = { ...todayEntry, ...updates };
    setEntries(prev => ({ ...prev, [today]: merged }));
    // debounce actual persistence so rapid changes don't spam the server
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persistEntry(today, merged);
    }, 300);
  }, [today, todayEntry, persistEntry]);

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
    const cur = todayEntry[field] || [];
    updateEntry({ [field]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] });
  };
  const toggleObj = (field, key) =>
    updateEntry({ [field]: { ...(todayEntry[field] || {}), [key]: !(todayEntry[field] || {})[key] } });

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
  const todayScore = score(todayEntry);
  const scorePct = Math.round((todayScore / maxScore) * 100);

  const inputStyle = { background: "#0e0e16", border: "1px solid #2a2a3a", borderRadius: "10px", padding: "8px 12px", color: "#e8e8f0", fontSize: "13px", outline: "none" };
  const textareaStyle = { ...inputStyle, width: "100%", resize: "vertical", lineHeight: 1.6 };

  // ── Render ──────────────────────────────────────────────────────────────────
  const logout = () => setToken("");

  if (!token) {
    // simple auth screen
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a10", color: "#e8e8f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 300, background: "#12121a", padding: 24, borderRadius: 12 }}>
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
                <h1 style={{ margin: 0, fontSize: "22px", fontFamily: "'Playfair Display', serif", fontWeight: 700, background: "linear-gradient(135deg,#c9b8ff,#f0acd4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  Daily Journal
                </h1>
                <LivePill connected={connected} viewers={viewers} />
                <SaveIndicator status={saveStatus} />
              </div>
              <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                {formatDate(today)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {["today", "history"].map(v => (
                <button key={v} onClick={() => setView(v)} style={{ padding: "7px 16px", borderRadius: "10px", border: view === v ? "1px solid #6d5acd" : "1px solid #2a2a3a", background: view === v ? "#6d5acd22" : "transparent", color: view === v ? "#c9b8ff" : "#666", cursor: "pointer", fontSize: "13px", fontWeight: 500, textTransform: "capitalize" }}>
                  {v}
                </button>
              ))}
            </div>
            <button onClick={logout} style={{ marginLeft: "12px", padding: "7px 16px", borderRadius: "10px", border: "1px solid #ef4444", background: "#ef444422", color: "#ef4444", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}>
              Log out
            </button>
          </div>
          {view === "today" && (
            <div style={{ marginTop: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#888", marginBottom: "4px" }}>
                <span>Today's wellness score</span>
                <span style={{ color: scorePct > 60 ? "#22c55e" : scorePct > 30 ? "#eab308" : "#ef4444", fontWeight: 600 }}>{scorePct}%</span>
              </div>
              <ScoreBar score={todayScore} max={maxScore} color={scorePct > 60 ? "#22c55e" : scorePct > 30 ? "#eab308" : "#6d5acd"} />
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "20px 16px 80px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#555" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📓</div>
            <div>Loading your journal…</div>
          </div>
        ) : view === "today" ? (
          <>
            <Section title="How are you feeling?" icon="💭" accent="#c9b8ff">
              <MoodSelector value={todayEntry.mood || null} onChange={v => updateEntry({ mood: v })} />
            </Section>

            <Section title="Medication" icon="💊" accent="#fb923c">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[...MEDICATIONS, ...(todayEntry.customMeds || [])].map(med => (
                  <ToggleChip key={med} label={med} emoji="💊" checked={(todayEntry.medications || []).includes(med)} onChange={() => toggle("medications", med)} color="#fb923c" />
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <input spellCheck={true} value={customMedInput} onChange={e => setCustomMedInput(e.target.value)} placeholder="+ add custom medication…" style={{ ...inputStyle, flex: 1 }}
                  onKeyDown={e => { if (e.key === "Enter" && customMedInput.trim()) { const l = customMedInput.trim(); updateEntry({ customMeds: [...(todayEntry.customMeds || []), l], medications: [...(todayEntry.medications || []), l] }); setCustomMedInput(""); } }}
                />
                <button onClick={() => { if (customMedInput.trim()) { const l = customMedInput.trim(); updateEntry({ customMeds: [...(todayEntry.customMeds || []), l], medications: [...(todayEntry.medications || []), l] }); setCustomMedInput(""); } }}
                  style={{ padding: "8px 16px", borderRadius: "10px", border: "1px solid #fb923c", background: "#fb923c22", color: "#fb923c", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                  Add
                </button>
              </div>
            </Section>

            <Section title="Nutrition" icon="🥗" accent="#4ade80">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                {FOODS.map(f => <ToggleChip key={f.label} label={f.label} emoji={f.emoji} checked={(todayEntry.food || []).includes(f.label)} onChange={() => toggle("food", f.label)} color="#4ade80" />)}
              </div>
              <textarea spellCheck={true} placeholder="What did you eat today?" value={todayEntry.food_notes || ""} onChange={e => updateEntry({ food_notes: e.target.value })} style={{ ...textareaStyle, minHeight: "70px", padding: "10px 12px" }} />
            </Section>

            <Section title="Personal Hygiene" icon="🚿" accent="#38bdf8">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {HYGIENE.map(h => <ToggleChip key={h.key} label={h.label} emoji={h.emoji} checked={!!(todayEntry.hygiene || {})[h.key]} onChange={() => toggleObj("hygiene", h.key)} color="#38bdf8" />)}
              </div>
            </Section>

            <Section title="House Cleaning" icon="🏠" accent="#f472b6">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {CLEANING.map(c => <ToggleChip key={c.key} label={c.label} emoji={c.emoji} checked={!!(todayEntry.cleaning || {})[c.key]} onChange={() => toggleObj("cleaning", c.key)} color="#f472b6" />)}
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
                      value={(todayEntry.workouts || {})[w.key] || 0}
                      onChange={e => updateEntry({
                        workouts: {
                          ...(todayEntry.workouts || {}),
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
              <textarea spellCheck={true} placeholder="How was your day? Anything on your mind…" value={todayEntry.notes || ""} onChange={e => updateNotes(e.target.value)} style={{ ...textareaStyle, minHeight: "120px", padding: "12px", fontSize: "14px" }} />
            </Section>

            <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: "16px", padding: "18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {[
                { label: "Medications taken", val: (todayEntry.medications || []).length, max: MEDICATIONS.length, color: "#fb923c" },
                { label: "Meals logged", val: (todayEntry.food || []).length, max: FOODS.length, color: "#4ade80" },
                { label: "Hygiene tasks", val: Object.values(todayEntry.hygiene || {}).filter(Boolean).length, max: HYGIENE.length, color: "#38bdf8" },
                { label: "Cleaning tasks", val: Object.values(todayEntry.cleaning || {}).filter(Boolean).length, max: CLEANING.length, color: "#f472b6" },
                { label: "Workouts done", val: todayEntry.workouts ? Object.values(todayEntry.workouts).filter(v => v > 0).length : 0, max: WORKOUTS.length, color: "#fcd34d" },
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
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: "18px", color: "#c9b8ff" }}>Past Entries</h2>
              <span style={{ color: "#666", fontSize: "13px" }}>{sortedDates.length} day{sortedDates.length !== 1 ? "s" : ""} logged</span>
            </div>
            {sortedDates.length === 0
              ? <div style={{ textAlign: "center", padding: "60px 20px", color: "#555", fontStyle: "italic" }}>No entries yet. Start tracking today!</div>
              : sortedDates.map(date => <EntryView key={date} date={date} entry={entries[date]} />)
            }
          </>
        )}
      </div>

      {/* Toast for remote updates */}
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}

// small component to capture email/password
function AuthForm({ mode, onSubmit }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const submit = (e) => {
    e.preventDefault();
    onSubmit(email, pass);
  };
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        style={{ padding: 8, borderRadius: 6, border: "1px solid #2a2a3a", background: "#0e0e16", color: "#e8e8f0" }}
      />
      <input
        type="password"
        placeholder="Password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        required
        style={{ padding: 8, borderRadius: 6, border: "1px solid #2a2a3a", background: "#0e0e16", color: "#e8e8f0" }}
      />
      <button type="submit" style={{ padding: 8, borderRadius: 6, background: "#4ade80", color: "#0a0a10", fontWeight: 600, cursor: "pointer" }}>
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
