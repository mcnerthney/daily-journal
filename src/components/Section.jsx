import React from "react";

export default function Section({ title, icon, children, accent }) {
    return (
        <div
            style={{
                background: "var(--surface)",
                border: `1px solid ${accent || "var(--border)"}`,
                borderRadius: "16px",
                padding: "20px",
                marginBottom: "16px",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "16px",
                }}
            >
                <span style={{ fontSize: "20px" }}>{icon}</span>
                <h3
                    style={{
                        margin: 0,
                        fontSize: "15px",
                        fontFamily: "'Playfair Display', serif",
                        fontWeight: 600,
                        color: accent || "var(--heading)",
                        letterSpacing: "0.02em",
                        textTransform: "uppercase",
                    }}
                >
                    {title}
                </h3>
            </div>
            {children}
        </div>
    );
}
