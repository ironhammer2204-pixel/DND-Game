import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { API_URL } from "../config";
import type React from "react";

type AuthTab = "login" | "register";

export function AuthPage() {
  const { setSession } = useAuthStore();
  const [activeTab, setActiveTab] = useState<AuthTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);

  const triggerShake = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 600);
  };

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      if (activeTab === "login") {
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");
        setSession(data.session.access_token, data.user);
      } else {
        const res = await fetch(`${API_URL}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, username }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Registration failed");
        setActiveTab("login");
        setPassword("");
        setAuthError("Account created! Please sign in.");
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setAuthError(msg);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (tab: AuthTab) => {
    setActiveTab(tab);
    setAuthError("");
  };

  return (
    <div className="auth-page">
      <div className="auth-bg" aria-hidden="true">
        <div className="auth-bg__runes">
          {["*", "+", "x", "~", "*", "+", "x", "~"].map((r, i) => (
            <span key={i} className="rune" style={{ "--rune-index": i } as React.CSSProperties}>{r}</span>
          ))}
        </div>
        <div className="auth-bg__grid" />
      </div>

      <div className="auth-layout">
        <aside className="auth-lore" aria-label="Game branding">
          <div className="auth-lore__inner">
            <div className="auth-lore__emblem" aria-hidden="true">+</div>
            <h1 className="auth-lore__title">Ironhammer</h1>
            <p className="auth-lore__subtitle">D&amp;D Campaign Manager</p>
            <div className="auth-lore__divider" aria-hidden="true" />
            <ul className="auth-lore__features">
              <li><span className="feature-icon">&#x1F5FA;</span><span>Create or join living campaigns</span></li>
              <li><span className="feature-icon">&#x1F3B2;</span><span>Cryptographically-fair dice rolls</span></li>
              <li><span className="feature-icon">&#x1F465;</span><span>Real-time party coordination</span></li>
              <li><span className="feature-icon">&#x1F4DC;</span><span>Persistent character sheets</span></li>
            </ul>
          </div>
        </aside>

        <main className="auth-form-panel">
          <div className={`auth-card${shaking ? " auth-card--shake" : ""}`}>
            <div className="auth-card__tabs" role="tablist">
              <button role="tab" aria-selected={activeTab === "login"}
                className={`auth-tab${activeTab === "login" ? " auth-tab--active" : ""}`}
                onClick={() => switchTab("login")} id="tab-login">
                Sign In
              </button>
              <button role="tab" aria-selected={activeTab === "register"}
                className={`auth-tab${activeTab === "register" ? " auth-tab--active" : ""}`}
                onClick={() => switchTab("register")} id="tab-register">
                Register
              </button>
            </div>

            {authError && (
              <div className={`auth-message${authError.includes("created") ? " auth-message--success" : " auth-message--error"}`} role="alert">
                {authError}
              </div>
            )}

            <form onSubmit={handleAuth}>
              {activeTab === "register" && (
                <div className="form-group">
                  <label htmlFor="auth-username">Username</label>
                  <input id="auth-username" type="text" className="input-field"
                    placeholder="Choose your adventurer name" value={username}
                    onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
                </div>
              )}
              <div className="form-group">
                <label htmlFor="auth-email">Email Address</label>
                <input id="auth-email" type="email" className="input-field"
                  placeholder="your@email.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              <div className="form-group">
                <label htmlFor="auth-password">Password</label>
                <input id="auth-password" type="password" className="input-field"
                  placeholder={activeTab === "register" ? "Choose a strong password" : "Enter your password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete={activeTab === "login" ? "current-password" : "new-password"} required />
              </div>
              <button type="submit" className="btn btn-primary auth-submit-btn" disabled={loading}>
                {loading ? (
                  <><span className="spinner" aria-hidden="true" />{activeTab === "login" ? "Signing in..." : "Creating account..."}</>
                ) : (
                  activeTab === "login" ? "Enter the Tavern" : "Begin Your Quest"
                )}
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
