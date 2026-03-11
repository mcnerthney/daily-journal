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
                border: checked ? `2px solid ${color || "#6d5acd"}` : "2px solid #2a2a3a",
                background: checked ? (color ? color + "22" : "#6d5acd22") : "#16161f",
                color: checked ? (color || "#b8aef0") : "#666",
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
