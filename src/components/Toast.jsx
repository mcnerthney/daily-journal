import React from "react";

export default function Toast({ message, visible }) {
    return (
        <div
            style={{
                position: "fixed",
                bottom: "24px",
                left: "50%",
                transform: `translateX(-50%) translateY(${visible ? 0 : "80px"})`,
                background: "#1e1e2e",
                border: "1px solid #6d5acd",
                borderRadius: "12px",
                padding: "10px 18px",
                fontSize: "13px",
                color: "#c9b8ff",
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                transition: "transform 0.3s ease, opacity 0.3s ease",
                opacity: visible ? 1 : 0,
                zIndex: 999,
                whiteSpace: "nowrap",
                pointerEvents: "none",
            }}
        >
            {message}
        </div>
    );
}
