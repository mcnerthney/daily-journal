import React from "react";

export default function SaveIndicator({ status }) {
    const map = {
        idle: { text: "", color: "transparent" },
        saving: { text: "Saving…", color: "var(--muted-strong)" },
        saved: { text: "✓ Saved", color: "var(--ok)" },
        error: { text: "Save failed", color: "var(--error)" },
    };
    const s = map[status] || map.idle;
    return (
        <span style={{ fontSize: "12px", color: s.color, transition: "color 0.3s", marginLeft: "12px" }}>
            {s.text}
        </span>
    );
}
