import React, { useState } from "react";

export default function AuthForm({ mode, onSubmit }) {
    const [email, setEmail] = useState("");
    const [pass, setPass] = useState("");
    const [confirmPass, setConfirmPass] = useState("");

    const isLogin = mode === "login";
    const isRegister = mode === "register";
    const isForgot = mode === "forgot";
    const isReset = mode === "reset";

    const submit = (e) => {
        e.preventDefault();
        onSubmit({ email, password: pass, confirmPassword: confirmPass });
    };

    return (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {!isReset && (
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{ padding: 8, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                />
            )}
            {!isForgot && (
                <input
                    type="password"
                    placeholder="Password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    required
                    minLength={8}
                    style={{ padding: 8, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                />
            )}
            {isReset && (
                <input
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    required
                    minLength={8}
                    style={{ padding: 8, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                />
            )}
            <button type="submit" style={{ padding: 8, borderRadius: 6, background: "var(--accent-primary)", color: "var(--surface)", fontWeight: 600, cursor: "pointer" }}>
                {isLogin && "Sign in"}
                {isRegister && "Create account"}
                {isForgot && "Send reset email"}
                {isReset && "Reset password"}
            </button>
        </form>
    );
}
