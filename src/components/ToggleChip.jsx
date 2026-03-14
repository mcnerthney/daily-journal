import React from "react";

export default function ToggleChip({ label, emoji, checked, onChange, color }) {
    return (
        <button
            onClick={() => onChange(!checked)}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "20px",
                border: checked ? `2px solid ${color || "var(--ring)"}` : "2px solid var(--border)",
                background: checked ? (color ? color + "22" : "var(--surface-soft)") : "var(--chip-idle-bg)",
                color: checked ? (color || "var(--muted-strong)") : "var(--chip-idle-text)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: checked ? 600 : 400,
                transition: "all 0.15s ease",
                userSelect: "none",
            }}
        >
            {emoji && <span style={{ fontSize: "15px" }}>{emoji}</span>}
            {label}
        </button>
    );
}
