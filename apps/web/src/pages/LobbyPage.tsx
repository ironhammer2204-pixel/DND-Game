import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthStore } from "../stores/authStore";
import { useGameStore, type LobbyCampaign } from "../stores/gameStore";
import { API_URL } from "../config";

export function LobbyPage() {
  const { token, user, clearSession } = useAuthStore();
  const { campaigns, setCampaigns, setActiveCampaign } = useGameStore();

  const [lobbyError, setLobbyError] = useState("");
  const joinDialogRef = useRef<HTMLDialogElement>(null);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed ${res.status}`);
    return data;
  };

  const fetchCampaigns = async () => {
    try {
      const data = await apiFetch("/api/campaigns");
      setCampaigns(data.campaigns ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unauthorized") || msg.includes("invalid token")) clearSession();
      setLobbyError(msg);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/api/campaigns`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          const msg: string = data.error ?? `Request failed ${res.status}`;
          if (msg.includes("Unauthorized") || msg.includes("invalid token")) clearSession();
          setLobbyError(msg);
          return;
        }
        setCampaigns(data.campaigns ?? []);
      } catch (err) {
        if (!cancelled) setLobbyError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const openJoinDialog = () => { setJoinError(""); setInviteCodeInput(""); joinDialogRef.current?.showModal(); };
  const closeJoinDialog = () => joinDialogRef.current?.close();
  const openCreateDialog = () => { setCreateError(""); setNewCampaignName(""); createDialogRef.current?.showModal(); };
  const closeCreateDialog = () => createDialogRef.current?.close();

  const handleJoinCampaign = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inviteCodeInput.trim()) return;
    setJoinError(""); setJoinLoading(true);
    try {
      const data = await apiFetch("/api/campaigns/join", {
        method: "POST",
        body: JSON.stringify({ invite_code: inviteCodeInput }),
      });
      closeJoinDialog();
      await fetchCampaigns();
      setActiveCampaign(data.campaign as LobbyCampaign, data.role as "player" | "dm");
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Failed to join campaign");
    } finally {
      setJoinLoading(false);
    }
  };

  const handleCreateCampaign = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newCampaignName.trim()) return;
    setCreateError(""); setCreateLoading(true);
    try {
      await apiFetch("/api/campaigns", { method: "POST", body: JSON.stringify({ name: newCampaignName }) });
      closeCreateDialog();
      void fetchCampaigns();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEnterCampaign = (camp: LobbyCampaign) => setActiveCampaign(camp, camp.role);

  return (
    <div className="lobby-page">
      <header className="lobby-header">
        <div className="lobby-header__brand">
          <span className="lobby-header__emblem" aria-hidden="true">&#x2694;</span>
          <span className="lobby-header__title">Ironhammer</span>
        </div>
        <div className="lobby-header__user">
          <div className="lobby-avatar" aria-hidden="true">{user?.username.charAt(0).toUpperCase()}</div>
          <div className="lobby-header__user-info">
            <span className="lobby-header__username">{user?.username}</span>
            <span className="lobby-header__email">{user?.email}</span>
          </div>
          <button className="btn btn-ghost" onClick={clearSession}>Sign Out</button>
        </div>
      </header>

      <main className="lobby-main">
        {lobbyError && <div className="auth-message auth-message--error" role="alert">{lobbyError}</div>}

        <div className="lobby-section-header">
          <div>
            <h2 className="lobby-section-title">Your Campaigns</h2>
            <p className="lobby-section-subtitle">
              {campaigns.length === 0
                ? "No campaigns yet — create one or join a friend's session."
                : `${campaigns.length} active campaign${campaigns.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="lobby-actions">
            <button className="btn btn-ghost" id="open-join-dialog" onClick={openJoinDialog}>&#x1F511; Join by Code</button>
            <button className="btn btn-primary" id="open-create-dialog" onClick={openCreateDialog}>&#x2736; New Campaign</button>
          </div>
        </div>

        {campaigns.length > 0 ? (
          <div className="campaign-grid" role="list">
            {campaigns.map((camp) => (
              <article key={camp.id} className="campaign-card" role="listitem">
                <div className="campaign-card__shimmer" aria-hidden="true" />
                <div className="campaign-card__body">
                  <div className="campaign-card__role-row">
                    <span className={`role-badge role-badge--${camp.role}`}>{camp.role}</span>
                  </div>
                  <h3 className="campaign-card__name">{camp.name}</h3>
                  <div className="campaign-card__meta"><span>DM: {camp.owner_name}</span></div>
                  <div className="campaign-card__code-row">
                    <span className="campaign-card__code-label">Invite code</span>
                    <code className="campaign-card__code">{camp.invite_code}</code>
                  </div>
                </div>
                <button className="btn btn-primary campaign-card__enter-btn" onClick={() => handleEnterCampaign(camp)}>
                  Enter Room &#x2192;
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="lobby-empty" role="status">
            <div className="lobby-empty__icon" aria-hidden="true">&#x1F3D5;</div>
            <p className="lobby-empty__text">No campaigns yet</p>
            <p className="lobby-empty__hint">Create a new one or join with an invite code.</p>
          </div>
        )}
      </main>

      <dialog ref={joinDialogRef} className="modal" aria-label="Join a campaign" id="join-campaign-dialog">
        <div className="modal__header">
          <h2 className="modal__title">Join a Campaign</h2>
          <button className="modal__close-btn btn btn-ghost" onClick={closeJoinDialog} aria-label="Close dialog">&#x2715;</button>
        </div>
        {joinError && <div className="auth-message auth-message--error" role="alert">{joinError}</div>}
        <form onSubmit={handleJoinCampaign}>
          <div className="form-group">
            <label htmlFor="join-invite-code">Invite Code</label>
            <input id="join-invite-code" type="text" className="input-field" placeholder="Enter 8-character invite code"
              value={inviteCodeInput} onChange={(e) => setInviteCodeInput(e.target.value.trim())}
              autoComplete="off" autoFocus required />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn-ghost" onClick={closeJoinDialog}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={joinLoading}>
              {joinLoading ? "Joining..." : "Join Campaign"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={createDialogRef} className="modal" aria-label="Create a campaign" id="create-campaign-dialog">
        <div className="modal__header">
          <h2 className="modal__title">New Campaign</h2>
          <button className="modal__close-btn btn btn-ghost" onClick={closeCreateDialog} aria-label="Close dialog">&#x2715;</button>
        </div>
        {createError && <div className="auth-message auth-message--error" role="alert">{createError}</div>}
        <form onSubmit={handleCreateCampaign}>
          <div className="form-group">
            <label htmlFor="create-campaign-name">Campaign Name</label>
            <input id="create-campaign-name" type="text" className="input-field"
              placeholder="e.g. The Lost Mines of Phandelver"
              value={newCampaignName} onChange={(e) => setNewCampaignName(e.target.value)} autoFocus required />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn-ghost" onClick={closeCreateDialog}>Cancel</button>
            <button type="submit" className="btn btn-gold" disabled={createLoading}>
              {createLoading ? "Creating..." : "Create Campaign"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
