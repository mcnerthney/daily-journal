import React from "react";
import { formatDate } from "../utils";
import ScoreBar from "./ScoreBar";
import { WORKOUTS } from "../data";

export default function EntryView({ entry, date }) {
    const mood = null; // mood rendering left to parent if needed
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
