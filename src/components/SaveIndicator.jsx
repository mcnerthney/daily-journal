import React from "react";

export default function SaveIndicator({ status }) {
    const map = {
        idle: { text: "", color: "transparent" },
        saving: { text: "Saving…", color: "#ffffff" },
        saved: { text: "✓ Saved", color: "#ffffff" },
        error: { text: "Save failed", color: "#ffffff" },
    };
    const s = map[status] || map.idle;
    return (
        <span style={{ fontSize: "12px", color: s.color, transition: "color 0.3s", marginLeft: "12px" }}>
            {s.text}
        </span>
    );
}
