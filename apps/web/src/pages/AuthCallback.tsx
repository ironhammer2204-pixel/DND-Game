import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { resolveApiUrl } from "../config";

interface AuthResponseUser {
  id: string;
  email: string;
  username: string;
  avatar_url?: string | null;
}

export function AuthCallback() {
  const { setSession } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function processCallback() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");

      try {
        const apiUrl = await resolveApiUrl();
        let sessionToken = accessToken;
        let userData: AuthResponseUser | null = null;

        if (code) {
          const res = await fetch(`${apiUrl}/api/auth/exchange`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "ngrok-skip-browser-warning": "true",
              "bypass-tunnel-reminder": "true",
            },
            body: JSON.stringify({ code }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || data.error || "Failed to complete Google sign-in");
          }

          sessionToken = data.session?.access_token ?? null;
          userData = data.user;
        } else if (accessToken) {
          const res = await fetch(`${apiUrl}/api/auth/me`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "ngrok-skip-browser-warning": "true",
              "bypass-tunnel-reminder": "true"
            },
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Failed to fetch user profile");
          }

          userData = data.user;
        } else {
          throw new Error("No authorization code or access token found in URL.");
        }

        if (!sessionToken || !userData) {
          throw new Error("Google sign-in did not return a usable session.");
        }

        setSession(sessionToken, userData);
        
        // Clean the URL and redirect to the app
        window.location.replace("/");
      } catch (err) {
        console.error("Auth callback error:", err);
        setError(err instanceof Error ? err.message : "Authentication failed");
        setTimeout(() => window.location.replace("/"), 3000);
      }
    }

    processCallback();
  }, [setSession]);

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

      <div className="auth-layout" style={{ justifyContent: "center" }}>
        <main className="auth-form-panel">
          <div className="auth-card" style={{ textAlign: "center" }}>
            <h2 style={{ marginBottom: "1rem" }}>Authenticating...</h2>
            {error ? (
              <div className="auth-message auth-message--error" role="alert">
                {error}
                <p style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>Redirecting...</p>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}>
                <span className="spinner" aria-hidden="true" style={{ width: "32px", height: "32px" }} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
