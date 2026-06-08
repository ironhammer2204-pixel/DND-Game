import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { resolveApiUrl } from "../config";
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
  const [googleLoading, setGoogleLoading] = useState(false);

  const triggerShake = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 600);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getErrorMessage = (err: any): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      if (typeof err.message === "string") return err.message;
      if (typeof err.error === "string") return err.error;
      try {
        return JSON.stringify(err);
      } catch {
        return "An unknown error occurred";
      }
    }
    return "An unknown error occurred";
  };

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const apiUrl = await resolveApiUrl();
      if (activeTab === "login") {
        const res = await fetch(`${apiUrl}/api/auth/login`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "X-Pinggy-No-Screen": "true",
            "ngrok-skip-browser-warning": "true",
            "bypass-tunnel-reminder": "true"
          },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          const errMsg = typeof data.error === "string" ? data.error : (data.message || data.error?.message || "Login failed");
          throw new Error(errMsg);
        }
        setSession(data.session.access_token, data.user);
      } else {
        const res = await fetch(`${apiUrl}/api/auth/register`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "X-Pinggy-No-Screen": "true",
            "ngrok-skip-browser-warning": "true",
            "bypass-tunnel-reminder": "true"
          },
          body: JSON.stringify({ email, password, username }),
        });
        const data = await res.json();
        if (!res.ok) {
          const errMsg = typeof data.error === "string" ? data.error : (data.message || data.error?.message || "Registration failed");
          throw new Error(errMsg);
        }
        setActiveTab("login");
        setPassword("");
        setAuthError("Account created! Please sign in.");
        return;
      }
    } catch (err) {
      setAuthError(getErrorMessage(err));
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (tab: AuthTab) => {
    setActiveTab(tab);
    setAuthError("");
  };

  const handleGoogleSignIn = async () => {
    setAuthError("");
    setGoogleLoading(true);

    try {
      const apiUrl = await resolveApiUrl();
      const callbackUrl = `${window.location.origin}/auth/callback`;
      const res = await fetch(`${apiUrl}/api/auth/google?redirect_to=${encodeURIComponent(callbackUrl)}`, {
        headers: {
          "Accept": "application/json",
          "X-Pinggy-No-Screen": "true",
          "ngrok-skip-browser-warning": "true",
          "bypass-tunnel-reminder": "true",
        },
      });

      const data = await res.json();
      if (!res.ok || !data.url) {
        const errMsg = typeof data.error === "string" ? data.error : (data.message || data.error?.message || "Unable to start Google sign-in");
        throw new Error(errMsg);
      }

      window.location.assign(data.url);
    } catch (err) {
      setAuthError(getErrorMessage(err));
      setGoogleLoading(false);
      triggerShake();
    }
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
              
              <div className="auth-divider">
                <span>or</span>
              </div>
              
              <button
                type="button"
                className="btn btn-secondary auth-google-btn"
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  <path d="M1 1h22v22H1z" fill="none"/>
                </svg>
                {googleLoading ? "Connecting..." : "Sign in with Google"}
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
