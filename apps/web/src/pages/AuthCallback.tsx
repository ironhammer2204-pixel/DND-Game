import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { resolveApiUrl } from "../config";

export function AuthCallback() {
  const { setSession } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function processCallback() {
      // Supabase OAuth appends the token in the URL hash, e.g., #access_token=xyz&expires_in=...
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");

      if (!accessToken) {
        setError("No access token found in URL.");
        // Redirect back to home after 2 seconds
        setTimeout(() => window.location.replace("/"), 2000);
        return;
      }

      try {
        const apiUrl = await resolveApiUrl();
        // Fetch the user profile from our backend
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

        // Set the session globally
        setSession(accessToken, data.user);
        
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
