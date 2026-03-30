import React from "react";
import { formatDate } from "../utils";
import ScoreBar from "./ScoreBar";
import { MOODS, WORKOUTS } from "../data";

export default function EntryView({ entry, date, onEdit }) {
    const mood = MOODS.find((m) => m.value === entry.mood) || null;
    const moodBarColor = mood
        ? {
            1: "#dc2626",
            2: "#f97316",
            3: "#eab308",
            4: "#84cc16",
            5: "#16a34a",
        }[mood.value] || "var(--ring)"
        : "var(--ring)";
    const counts = [
        { label: `💊 ${(entry.medications || []).length}`, active: (entry.medications || []).length > 0 },
        { label: `🥗 ${(entry.food || []).length}`, active: (entry.food || []).length > 0 },
        { label: `🚿 ${Object.values(entry.hygiene || {}).filter(Boolean).length}`, active: Object.values(entry.hygiene || {}).some(Boolean) },
        { label: `🏠 ${Object.values(entry.cleaning || {}).filter(Boolean).length}`, active: Object.values(entry.cleaning || {}).some(Boolean) },
        { label: `🏋️ ${entry.workouts ? Object.values(entry.workouts).filter(v => v > 0).length : 0}`, active: entry.workouts && Object.values(entry.workouts).some(v => v > 0) },
    ];
    return (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "18px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <div>
                    <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "4px" }}>{formatDate(date)}</div>
                    {mood && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", maxWidth: "220px" }}>
                            <span style={{ fontSize: "18px", color: mood.color }}>{mood.emoji}</span>
                            <span style={{ color: mood.color, fontWeight: 600, fontSize: "14px" }}>{mood.label}</span>
                            <div style={{ flex: 1 }}>
                                <ScoreBar score={mood.value} max={5} color={moodBarColor} />
                            </div>
                        </div>
                    )}
                    {(entry.systolic || entry.diastolic) && (
                        <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--muted)" }}>🩺 {entry.systolic || "--"}/{entry.diastolic || "--"}</div>
                    )}
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {counts.map((b, i) => (
                        <span key={i} style={{ padding: "3px 10px", borderRadius: "10px", background: b.active ? "var(--ring-soft)" : "var(--surface-alt)", color: b.active ? "var(--heading)" : "var(--muted-strong)", fontSize: "12px" }}>{b.label}</span>
                    ))}
                    {onEdit && (
                        <button
                            onClick={() => onEdit(date)}
                            style={{
                                background: "none",
                                border: "none",
                                color: "var(--accent-primary)",
                                cursor: "pointer",
                                fontSize: "12px",
                            }}
                        >
                            ✏️
                        </button>
                    )}
                </div>
            </div>
            {entry.food_notes && <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px", lineHeight: 1.6, fontStyle: "italic", borderTop: "1px solid var(--border)", paddingTop: "10px" }}>{entry.food_notes}</p>}
            {entry.workouts && Object.values(entry.workouts).some(v => v > 0) && (
                <div style={{ marginTop: "8px", color: "var(--muted-strong)", fontSize: "13px" }}>
                    {WORKOUTS.map(w => {
                        const val = entry.workouts && entry.workouts[w.key];
                        return val > 0 ? <div key={w.key}>{w.emoji} {w.label}: {val}</div> : null;
                    })}
                </div>
            )}

            {entry.notes && <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px", lineHeight: 1.6, fontStyle: "italic", borderTop: "1px solid var(--border)", paddingTop: "10px" }}>{entry.notes}</p>}
        </div>
    );
}
