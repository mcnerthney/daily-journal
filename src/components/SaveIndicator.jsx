import React from "react";

export default function SaveIndicator({ status }) {
    const map = {
        idle: { text: "", color: "transparent" },
        saving: { text: "Saving…", color: "#eab308" },
        saved: { text: "✓ Saved", color: "#22c55e" },
        error: { text: "Save failed", color: "#ef4444" },
    };
    const s = map[status] || map.idle;
    return (
        <span style={{ fontSize: "12px", color: s.color, transition: "color 0.3s", marginLeft: "12px" }}>
            {s.text}
        </span>
    );
}
