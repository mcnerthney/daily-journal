import React from "react";
import { MOODS } from "../data.js";

export default function MoodSelector({ value, onChange }) {
    return (
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {MOODS.map((m) => (
                <button
                    key={m.value}
                    onClick={() => onChange(value === m.value ? null : m.value)}
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "4px",
                        padding: "12px 16px",
                        borderRadius: "14px",
                        border: value === m.value ? `2px solid ${m.color}` : "2px solid var(--border)",
                        background: value === m.value ? m.color + "22" : "var(--surface-alt)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        minWidth: "60px",
                        transform: value === m.value ? "scale(1.08)" : "scale(1)",
                    }}
                >
                    <span style={{ fontSize: "26px" }}>{m.emoji}</span>
                    <span
                        style={{
                            fontSize: "11px",
                            color: value === m.value ? m.color : "var(--muted)",
                            fontWeight: 500,
                        }}
                    >
                        {m.label}
                    </span>
                </button>
            ))}
        </div>
    );
}
