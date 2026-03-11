import React from "react";

export default function ScoreBar({ score, max, color }) {
    const pct = max > 0 ? (score / max) * 100 : 0;
    return (
        <div
            style={{
                height: "6px",
                background: "#2a2a3a",
                borderRadius: "3px",
                overflow: "hidden",
                marginTop: "6px",
            }}
        >
            <div
                style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: color || "#6d5acd",
                    borderRadius: "3px",
                    transition: "width 0.4s ease",
                }}
            />
        </div>
    );
}
