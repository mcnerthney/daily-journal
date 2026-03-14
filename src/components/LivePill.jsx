import React from "react";

export default function LivePill({ connected, viewers }) {
    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                borderRadius: "20px",
                background: connected ? "var(--accent-primary-soft)" : "var(--error-soft)",
                border: `1px solid ${connected ? "var(--accent-primary)" : "var(--error)"}`,
                fontSize: "12px",
                color: connected ? "var(--accent-primary)" : "var(--error)",
                transition: "all 0.3s",
            }}
        >
            <span
                style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: connected ? "var(--accent-primary)" : "var(--error)",
                    boxShadow: connected ? "0 0 6px var(--accent-primary)" : "none",
                    animation: connected ? "pulse 2s infinite" : "none",
                    flexShrink: 0,
                }}
            />
            {connected ? `${viewers} viewer${viewers !== 1 ? "s" : ""} live` : "Reconnecting…"}
        </div>
    );
}
