import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useGameStore } from "../stores/gameStore";
import { WsReconnectBanner } from "../components/WsReconnectBanner";
import { DicePanel } from "../components/DicePanel";
import { RACES, CLASSES } from "@dnd/shared";
import { API_URL, WS_URL } from "../config";
import type { Character, DiceType, ServerWSMessage, ServerMessageType } from "@dnd/shared";
import type React from "react";

interface ChatPayload { sender_name: string; text: string; }
interface ExplorationPayload {
  roller_name: string; dice_type: string;
  raw: number; modifier: number; final: number; context: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  const el = document.createElement("textarea");
  el.value = text;
  Object.assign(el.style, { position: "fixed", left: "-9999px", top: "-9999px" });
  document.body.appendChild(el);
  el.focus(); el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  return ok;
}

export function GamePage() {
  const { token, user, clearSession } = useAuthStore();
  const {
    activeCampaign, activeRole, partyCharacters, myCharacter, eventLogs,
    ws, wsStatus, setPartyCharacters, setMyCharacter, clearEvents,
    setWs, setWsStatus, handleWsMessage, setActiveCampaign,
  } = useGameStore();

  const [chatMessage, setChatMessage] = useState("");
  const [charName, setCharName] = useState("");
  const [charRace, setCharRace] = useState<string>(RACES[0]);
  const [charClass, setCharClass] = useState<string>(CLASSES[0]);
  const [charError, setCharError] = useState("");
  const [copyToast, setCopyToast] = useState<"success" | "fail" | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed ${res.status}`);
    return data;
  };

  const fetchPartyCharacters = async (campaignId: string) => {
    try {
      const data = await apiFetch(`/api/characters/campaign/${campaignId}`);
      const chars: Character[] = data.characters ?? [];
      setPartyCharacters(chars);
      setMyCharacter(chars.find((c) => c.user_id === user?.id) ?? null);
    } catch (err) { console.error("Error fetching party:", err); }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLogs]);

  useEffect(() => {
    if (!activeCampaign || !token || !user) return;
    clearEvents();
    void fetchPartyCharacters(activeCampaign.id);
    setWsStatus("connecting");
    const socket = new WebSocket(`${WS_URL}?token=${token}`);

    socket.onopen = () => {
      setWsStatus("connected");
      setWs(socket);
      socket.send(JSON.stringify({ type: "JOIN_CAMPAIGN", payload: { invite_code: activeCampaign.invite_code } }));
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerWSMessage<ServerMessageType>;
        handleWsMessage(message, user.id, fetchPartyCharacters);
      } catch (err) { console.error("WS parse error:", err); }
    };
    socket.onclose = () => { setWsStatus("disconnected"); setWs(null); };
    socket.onerror = () => { setWsStatus("disconnected"); };

    return () => { socket.close(); setWs(null); setWsStatus("disconnected"); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign?.id, token]);

  const sendChat = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!chatMessage.trim() || !ws) return;
    ws.send(JSON.stringify({ type: "CHAT_MESSAGE", payload: { text: chatMessage } }));
    setChatMessage("");
  };

  const rollDice = (dice: DiceType, modifier: number) => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "DICE_REQUEST", payload: { dice_type: dice, context: "Quick Roll", modifier } }));
  };

  const rollAttribute = (attrName: string, score: number) => {
    if (!ws || !myCharacter) return;
    ws.send(JSON.stringify({ type: "DICE_REQUEST", payload: {
      dice_type: "d20", context: `roll:${attrName.toUpperCase()}`, modifier: Math.floor((score - 10) / 2),
    } }));
  };

  const handleCreateCharacter = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCharError("");
    if (!charName.trim() || !activeCampaign) return;
    try {
      const data = await apiFetch("/api/characters", {
        method: "POST",
        body: JSON.stringify({ campaign_id: activeCampaign.id, name: charName, race: charRace, class: charClass }),
      });
      setCharName("");
      setMyCharacter(data.character as Character);
      void fetchPartyCharacters(activeCampaign.id);
      ws?.send(JSON.stringify({ type: "JOIN_CAMPAIGN", payload: { invite_code: activeCampaign.invite_code } }));
    } catch (err) { setCharError(err instanceof Error ? err.message : "Failed to create character"); }
  };

  const handleCopyInvite = async () => {
    if (!activeCampaign) return;
    const ok = await copyToClipboard(activeCampaign.invite_code);
    setCopyToast(ok ? "success" : "fail");
    setTimeout(() => setCopyToast(null), 2500);
  };

  if (!activeCampaign) return null;

  return (
    <div className="game-page">
      <WsReconnectBanner status={wsStatus} />

      <header className="game-header">
        <div className="game-header__left">
          <button className="btn btn-ghost game-header__back-btn" onClick={() => setActiveCampaign(null, null)}>
            &#x2190; Lobby
          </button>
          <div className="game-header__campaign">
            <h1 className="game-header__campaign-name">{activeCampaign.name}</h1>
          </div>
          <button className="game-invite-pill" onClick={handleCopyInvite}
            title="Click to copy invite code" aria-label={`Copy invite code ${activeCampaign.invite_code}`}>
            <span className="game-invite-pill__label">Invite:</span>
            <code className="game-invite-pill__code">{activeCampaign.invite_code}</code>
            <span className="game-invite-pill__icon" aria-hidden="true">&#x1F4CB;</span>
          </button>
          {copyToast && (
            <div className={`copy-toast copy-toast--${copyToast}`} role="status" aria-live="polite">
              {copyToast === "success" ? "Copied!" : `Copy failed - code: ${activeCampaign.invite_code}`}
            </div>
          )}
        </div>
        <div className="game-header__right">
          <span className={`role-badge role-badge--${activeRole}`}>
            {activeRole === "dm" ? "DM" : "Player"}
          </span>
          <span className="game-header__username">{user?.username}</span>
          <button className="btn btn-danger" onClick={clearSession}>Logout</button>
        </div>
      </header>

      <div className="game-layout">
        <aside className="sidebar-left" aria-label="Campaign party">
          <div className="sidebar-section-title">Campaign Party</div>
          <div className="member-list" role="list">
            {partyCharacters.map((char) => {
              const isMe = char.user_id === user?.id;
              const hpPct = Math.max(0, (char.hp_current / char.hp_max) * 100);
              return (
                <div key={char.id} className={`member-card${isMe ? " member-card--me" : ""}`} role="listitem">
                  <div className="member-card__header">
                    <div className="member-card__avatar" aria-hidden="true">{char.name.charAt(0)}</div>
                    <div className="member-card__info">
                      <span className="member-card__name">{char.name}</span>
                      <span className="member-card__subtitle">{char.race} {char.class}</span>
                    </div>
                    <div className="member-card__level">Lv.{char.level}</div>
                  </div>
                  <div className="member-card__hp-bar">
                    <div className="member-card__hp-fill" style={{ width: `${hpPct}%` }}
                      role="progressbar" aria-valuenow={char.hp_current} aria-valuemin={0} aria-valuemax={char.hp_max}
                      aria-label={`${char.name} HP`} />
                  </div>
                  <div className="member-card__hp-label">{char.hp_current} / {char.hp_max} HP</div>
                </div>
              );
            })}
            {partyCharacters.length === 0 && (
              <div className="member-list__empty">No adventurers have joined yet...</div>
            )}
          </div>
        </aside>

        <main className="chat-column" aria-label="Game events and chat">
          <div className="chat-log" role="log" aria-live="polite" aria-atomic="false">
            {eventLogs.map((log) => {
              if (log.type === "system") {
                const p = log.payload as { text: string };
                return <div key={log.id} className="chat-card chat-card--system" role="note"><span>{p.text}</span></div>;
              }
              if (log.type === "chat") {
                const p = log.payload as ChatPayload;
                const isMe = log.actor_name === user?.username;
                return (
                  <div key={log.id} className={`chat-card chat-card--chat${isMe ? " chat-card--me" : ""}`}>
                    <div className="chat-card__header">
                      <span className="chat-card__sender">{log.actor_name ?? p.sender_name}</span>
                      <time className="chat-card__time" dateTime={log.timestamp}>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>
                    <p className="chat-card__text">{p.text}</p>
                  </div>
                );
              }
              if (log.type === "exploration") {
                const p = log.payload as ExplorationPayload;
                return (
                  <div key={log.id} className="chat-card chat-card--roll">
                    <div className="chat-card__header">
                      <span className="chat-card__sender">{log.actor_name ?? p.roller_name}</span>
                      <time className="chat-card__time" dateTime={log.timestamp}>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>
                    <div className="roll-result">
                      <div className="roll-result__die" aria-hidden="true">{p.dice_type}</div>
                      <div className="roll-result__breakdown">
                        <span className="roll-result__context">{p.context}</span>
                        <span className="roll-result__formula">
                          {p.raw}{p.modifier !== 0 && <span className="roll-result__mod">{p.modifier >= 0 ? ` +${p.modifier}` : ` ${p.modifier}`}</span>}
                        </span>
                      </div>
                      <div className="roll-result__total" aria-label={`Total: ${p.final}`}>{p.final}</div>
                    </div>
                  </div>
                );
              }
              return null;
            })}
            <div ref={chatEndRef} />
          </div>

          <form className="chat-input-bar" onSubmit={sendChat} aria-label="Send a message">
            <input type="text" className="input-field chat-input-bar__input"
              placeholder={wsStatus !== "connected" ? "Connecting..." : "Type a message or describe your action..."}
              value={chatMessage} onChange={(e) => setChatMessage(e.target.value)}
              disabled={wsStatus !== "connected"} aria-label="Chat message" id="chat-message-input" />
            <button type="submit" className="btn btn-primary" disabled={wsStatus !== "connected" || !chatMessage.trim()}>
              Send
            </button>
          </form>
        </main>

        <aside className="sidebar-right" aria-label={activeRole === "dm" ? "DM Panel" : "Character panel"}>
          {activeRole === "dm" ? (
            <div className="right-panel">
              <div className="right-panel__header">
                <h2 className="right-panel__title">DM Panel</h2>
                <span className="right-panel__role-indicator" aria-hidden="true">&#x265B;</span>
              </div>
              <p className="right-panel__dm-desc">You oversee the campaign. Narrate story beats and challenge the party.</p>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Quick Dice</div>
                <DicePanel onRoll={rollDice} disabled={wsStatus !== "connected"} />
              </div>
            </div>
          ) : myCharacter ? (
            <div className="right-panel animate-fade-in">
              <div className="sheet-header">
                <h2 className="sheet-name">{myCharacter.name}</h2>
                <p className="sheet-meta">Level {myCharacter.level} &middot; {myCharacter.race} {myCharacter.class}</p>
              </div>
              <div className="hp-block">
                <div className="hp-block__label-row">
                  <span>Hit Points</span>
                  <span className="hp-block__values">{myCharacter.hp_current} / {myCharacter.hp_max}</span>
                </div>
                <div className="hp-bar" role="progressbar" aria-valuenow={myCharacter.hp_current} aria-valuemin={0} aria-valuemax={myCharacter.hp_max} aria-label="Hit points">
                  <div className="hp-bar__fill" style={{
                    width: `${Math.max(0, (myCharacter.hp_current / myCharacter.hp_max) * 100)}%`,
                    background: myCharacter.hp_current / myCharacter.hp_max > 0.5 ? "var(--success-green)" : myCharacter.hp_current / myCharacter.hp_max > 0.25 ? "var(--accent-gold)" : "var(--danger-red)",
                  }} />
                </div>
              </div>
              <div className="stat-grid">
                <div className="stat-card"><div className="stat-card__val">{myCharacter.xp}</div><div className="stat-card__lbl">XP</div></div>
                <div className="stat-card"><div className="stat-card__val">{myCharacter.gold}g</div><div className="stat-card__lbl">Gold</div></div>
              </div>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Attributes &mdash; click to roll d20</div>
                <div className="attr-list" role="list">
                  {Object.entries(myCharacter.attributes).map(([attr, score]) => {
                    const n = Number(score);
                    const mod = Math.floor((n - 10) / 2);
                    return (
                      <button key={attr} role="listitem" className="attr-row"
                        onClick={() => rollAttribute(attr, n)} disabled={wsStatus !== "connected"}
                        aria-label={`${attr.toUpperCase()} ${n}, modifier ${mod >= 0 ? "+" : ""}${mod}`}>
                        <span className="attr-row__abbv">{attr.toUpperCase()}</span>
                        <span className="attr-row__score">{n}</span>
                        <span className="attr-row__mod">{mod >= 0 ? `+${mod}` : mod}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Quick Dice</div>
                <DicePanel onRoll={rollDice} disabled={wsStatus !== "connected"} />
              </div>
            </div>
          ) : (
            <div className="right-panel animate-fade-in">
              <div className="right-panel__header"><h2 className="right-panel__title">Create Character</h2></div>
              <p className="right-panel__dm-desc">You haven't created your adventurer for this campaign yet.</p>
              {charError && <div className="auth-message auth-message--error" role="alert">{charError}</div>}
              <form onSubmit={handleCreateCharacter}>
                <div className="form-group">
                  <label htmlFor="char-name">Name</label>
                  <input id="char-name" type="text" className="input-field" placeholder="e.g. Thorin Ironhammer"
                    value={charName} onChange={(e) => setCharName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="char-race">Race</label>
                  <select id="char-race" className="input-field" value={charRace} onChange={(e) => setCharRace(e.target.value)}>
                    {RACES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="char-class">Class</label>
                  <select id="char-class" className="input-field" value={charClass} onChange={(e) => setCharClass(e.target.value)}>
                    {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "12px" }}>
                  &#x2694; Spawn Character
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
