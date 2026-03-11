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
                background: connected ? "#0d2d1a" : "#2a1a1a",
                border: `1px solid ${connected ? "#22c55e44" : "#ef444444"}`,
                fontSize: "12px",
                color: connected ? "#4ade80" : "#f87171",
                transition: "all 0.3s",
            }}
        >
            <span
                style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: connected ? "#22c55e" : "#ef4444",
                    boxShadow: connected ? "0 0 6px #22c55e" : "none",
                    animation: connected ? "pulse 2s infinite" : "none",
                    flexShrink: 0,
                }}
            />
            {connected ? `${viewers} viewer${viewers !== 1 ? "s" : ""} live` : "Reconnecting…"}
        </div>
    );
}
