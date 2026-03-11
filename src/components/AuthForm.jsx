import React, { useState } from "react";

export default function AuthForm({ mode, onSubmit }) {
    const [email, setEmail] = useState("");
    const [pass, setPass] = useState("");
    const submit = (e) => {
        e.preventDefault();
        onSubmit(email, pass);
    };
    return (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ padding: 8, borderRadius: 6, border: "1px solid #2a2a3a", background: "#0e0e16", color: "#e8e8f0" }}
            />
            <input
                type="password"
                placeholder="Password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                required
                style={{ padding: 8, borderRadius: 6, border: "1px solid #2a2a3a", background: "#0e0e16", color: "#e8e8f0" }}
            />
            <button type="submit" style={{ padding: 8, borderRadius: 6, background: "#4ade80", color: "#0a0a10", fontWeight: 600, cursor: "pointer" }}>
                {mode === "login" ? "Sign in" : "Create account"}
            </button>
        </form>
    );
}
