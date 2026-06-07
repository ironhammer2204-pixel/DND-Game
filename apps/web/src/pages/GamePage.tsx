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
interface InventoryRow {
  id: string;
  character_id: string;
  item_id: string;
  quantity: number;
  is_equipped: boolean;
  acquired_at: string;
  name: string;
  type: string;
  description?: string;
  stats: Record<string, string | number | boolean>;
  value_gp: number;
  is_consumable: boolean;
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
    activeCombat
  } = useGameStore();

  const [chatMessage, setChatMessage] = useState("");
  const [charName, setCharName] = useState("");
  const [charRace, setCharRace] = useState<string>(RACES[0]);
  const [charClass, setCharClass] = useState<string>(CLASSES[0]);
  const [charError, setCharError] = useState("");
  const [copyToast, setCopyToast] = useState<"success" | "fail" | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [inventoryError, setInventoryError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Combat spawning local states
  const [selectedMonster, setSelectedMonster] = useState("goblin");
  const [monsterCount, setMonsterCount] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState("");


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
      const currentCharacter = chars.find((c) => c.user_id === user?.id) ?? null;
      setMyCharacter(currentCharacter);
      if (currentCharacter) {
        void fetchInventory(currentCharacter.id);
      } else {
        setInventory([]);
      }
    } catch (err) { console.error("Error fetching party:", err); }
  };

  const fetchInventory = async (characterId: string) => {
    try {
      setInventoryError("");
      const data = await apiFetch(`/api/characters/${characterId}/inventory`);
      setInventory(data.inventory ?? []);
    } catch (err) {
      console.error("Error fetching inventory:", err);
      setInventoryError(err instanceof Error ? err.message : "Unable to load inventory");
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLogs]);

  useEffect(() => {
    if (!activeCampaign || !token || !user) return;
    clearEvents();
    const loadTimer = window.setTimeout(() => {
      void fetchPartyCharacters(activeCampaign.id);
    }, 0);
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

    return () => { window.clearTimeout(loadTimer); socket.close(); setWs(null); setWsStatus("disconnected"); };
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
      void fetchInventory((data.character as Character).id);
      void fetchPartyCharacters(activeCampaign.id);
      ws?.send(JSON.stringify({ type: "JOIN_CAMPAIGN", payload: { invite_code: activeCampaign.invite_code } }));
    } catch (err) { setCharError(err instanceof Error ? err.message : "Failed to create character"); }
  };

  const toggleInventoryEquip = async (item: InventoryRow) => {
    if (!myCharacter) return;
    try {
      await apiFetch(`/api/characters/${myCharacter.id}/inventory/${item.id}/equip`, {
        method: "PATCH",
        body: JSON.stringify({ is_equipped: !item.is_equipped }),
      });
      void fetchInventory(myCharacter.id);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "Failed to update equipment");
    }
  };

  const dropInventoryItem = async (item: InventoryRow) => {
    if (!myCharacter) return;
    try {
      await apiFetch(`/api/characters/${myCharacter.id}/inventory/${item.id}`, { method: "DELETE" });
      void fetchInventory(myCharacter.id);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "Failed to drop item");
    }
  };

  const handleCopyInvite = async () => {
    if (!activeCampaign) return;
    const ok = await copyToClipboard(activeCampaign.invite_code);
    setCopyToast(ok ? "success" : "fail");
    setTimeout(() => setCopyToast(null), 2500);
  };

  if (!activeCampaign) return null;

  const equippedItems = inventory.filter((item) => item.is_equipped);
  const equippedArmor = equippedItems.find((item) => item.type === "armor" && item.stats.ac_base);
  const shieldBonus = equippedItems
    .filter((item) => item.type === "armor" && item.stats.ac_bonus)
    .reduce((total, item) => total + Number(item.stats.ac_bonus || 0), 0);
  const dexModifier = myCharacter ? Math.floor((Number(myCharacter.attributes.dex) - 10) / 2) : 0;
  const armorBase = equippedArmor ? Number(equippedArmor.stats.ac_base) : 10;
  const allowsDexBonus = equippedArmor ? Boolean(equippedArmor.stats.dex_bonus) : true;
  const derivedAc = armorBase + (allowsDexBonus ? dexModifier : 0) + shieldBonus;

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
          {activeCombat && (
            <div className="combat-tracker-panel animate-fade-in" style={{ padding: "12px", borderBottom: "1px solid var(--border-dark)", background: "rgba(10, 11, 20, 0.7)", backdropFilter: "blur(8px)" }}>
              <div className="combat-tracker-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div className="combat-tracker-title" style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-cinzel)", fontWeight: "bold", color: "var(--accent-gold)" }}>
                  <span className="combat-icon">⚔️</span>
                  <span>Combat &mdash; Round {activeCombat.round_number}</span>
                </div>
                <div className="combat-active-turn" style={{ fontSize: "0.85rem", color: "var(--text-light)" }}>
                  Active Turn: <span className="active-name" style={{ color: "var(--accent-gold)", fontWeight: "bold" }}>{activeCombat.turn_order[activeCombat.current_turn_index]?.name}</span>
                </div>
              </div>

              {/* Participant List */}
              <div className="combat-participants-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "8px", marginBottom: "12px", maxHeight: "150px", overflowY: "auto", padding: "4px" }}>
                {activeCombat.turn_order.map((p, idx) => {
                  const isCurrent = idx === activeCombat.current_turn_index;
                  const hpPct = Math.max(0, (p.hp_current / p.hp_max) * 100);
                  const isDead = p.hp_current <= 0;
                  const isUnconscious = isDead && p.type === "player" && !p.conditions.includes("stable");
                  const isStable = p.conditions.includes("stable");

                  return (
                    <div key={p.id} className={`combat-p-card ${isCurrent ? 'combat-p-card--current' : ''} ${isDead ? 'combat-p-card--dead' : ''}`} style={{
                      padding: "8px",
                      borderRadius: "6px",
                      background: isCurrent ? "rgba(184, 134, 11, 0.15)" : "rgba(255, 255, 255, 0.03)",
                      border: isCurrent ? "1px solid var(--accent-gold)" : "1px solid var(--border-dark)",
                      opacity: isDead ? 0.6 : 1,
                      transition: "all 0.3s ease"
                    }}>
                      <div className="combat-p-card__header" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", fontWeight: "600", marginBottom: "4px" }}>
                        <span className="combat-p-card__name" style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "100px", color: isCurrent ? "var(--accent-gold)" : "var(--text-light)" }}>
                          {isCurrent && <span className="current-arrow">👉 </span>}
                          {p.name}
                        </span>
                        <span className="combat-p-card__hp" style={{ color: "var(--text-dim)" }}>{p.hp_current}/{p.hp_max}</span>
                      </div>
                      <div className="combat-p-card__hp-bar" style={{ height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden", marginBottom: "4px" }}>
                        <div className="combat-p-card__hp-fill" style={{ width: `${hpPct}%`, height: "100%", transition: "width 0.3s ease", background: p.hp_current / p.hp_max > 0.5 ? "var(--success-green)" : p.hp_current / p.hp_max > 0.25 ? "var(--accent-gold)" : "var(--danger-red)" }} />
                      </div>
                      <div className="combat-p-card__details" style={{ display: "flex", flexWrap: "wrap", gap: "4px", fontSize: "0.7rem", alignItems: "center" }}>
                        <span className="combat-p-card__stat" style={{ color: "var(--text-dim)" }}>AC: {p.ac}</span>
                        {p.conditions.map(c => (
                          <span key={c} className={`condition-badge condition-badge--${c}`} style={{ background: "rgba(184, 134, 11, 0.2)", border: "1px solid var(--accent-gold)", borderRadius: "3px", padding: "1px 3px" }}>{c}</span>
                        ))}
                        {isUnconscious && (
                          <div className="combat-p-card__death-saves" style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                            <span style={{ color: "var(--danger-red)" }}>💀</span>
                            <span style={{ color: "var(--success-green)" }}>✓</span>{p.death_save_successes}
                            <span style={{ color: "var(--danger-red)", marginLeft: "4px" }}>✗</span>{p.death_save_failures}
                          </div>
                        )}
                        {isStable && <span className="stable-badge" style={{ color: "var(--success-green)" }}>Stable</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Console */}
              {(() => {
                const activeParticipant = activeCombat.turn_order[activeCombat.current_turn_index];
                if (!activeParticipant) return null;

                const isMyTurn = myCharacter && activeParticipant.id === myCharacter.id;
                const isEnemyTurn = activeParticipant.type === "enemy";

                if (isEnemyTurn) {
                  return (
                    <div className="combat-action-console combat-action-console--enemy" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "6px", fontSize: "0.85rem", color: "var(--text-dim)" }}>
                      <span className="loading-spinner-small" style={{ width: "12px", height: "12px", border: "2px solid var(--text-dim)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                      <span>{activeParticipant.name} is preparing to strike...</span>
                    </div>
                  );
                }

                if (isMyTurn) {
                  const isDowned = myCharacter.hp_current === 0 && !activeParticipant.conditions.includes("stable");
                  if (isDowned) {
                    return (
                      <div className="combat-action-console combat-action-console--downed" style={{ padding: "8px", background: "rgba(139,0,0,0.1)", border: "1px solid var(--danger-red)", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.85rem", color: "var(--danger-red)", fontWeight: "600" }}>⚠️ Unconscious! Roll Death Save.</span>
                        <button onClick={() => ws?.send(JSON.stringify({ type: "DEATH_SAVE_ROLL", payload: {} }))} className="btn btn-danger" style={{ padding: "4px 12px" }}>
                          💀 Roll Death Save
                        </button>
                      </div>
                    );
                  }

                  const enemies = activeCombat.turn_order.filter(p => p.type === "enemy" && p.hp_current > 0);
                  const currentTargetId = selectedTarget && enemies.some(e => e.id === selectedTarget)
                    ? selectedTarget
                    : (enemies[0]?.id || "");

                  return (
                    <div className="combat-action-console" style={{ padding: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-dark)", borderRadius: "6px" }}>
                      <div className="action-console-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div className="form-group flex-grow" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <label htmlFor="combat-target-select" style={{ fontSize: "0.8rem", color: "var(--text-dim)", whiteSpace: "nowrap" }}>Target:</label>
                          <select id="combat-target-select" className="input-field" value={currentTargetId} onChange={e => setSelectedTarget(e.target.value)} style={{ padding: "4px 8px" }}>
                            {enemies.map(e => (
                              <option key={e.id} value={e.id}>{e.name} ({e.hp_current}/{e.hp_max} HP)</option>
                            ))}
                            {enemies.length === 0 && <option value="">No targets left</option>}
                          </select>
                        </div>
                        <div className="action-buttons" style={{ display: "flex", gap: "6px" }}>
                          <button onClick={() => ws?.send(JSON.stringify({
                            type: "COMBAT_ACTION",
                            payload: { action_type: "attack", target_id: currentTargetId }
                          }))} className="btn btn-primary" style={{ padding: "4px 12px" }} disabled={enemies.length === 0}>
                            ⚔️ Attack
                          </button>
                          <button onClick={() => ws?.send(JSON.stringify({
                            type: "COMBAT_ACTION",
                            payload: { action_type: "dodge" }
                          }))} className="btn btn-ghost" style={{ padding: "4px 12px" }}>
                            🛡️ Dodge
                          </button>
                          <button onClick={() => ws?.send(JSON.stringify({
                            type: "COMBAT_ACTION",
                            payload: { action_type: "end_turn" }
                          }))} className="btn btn-secondary" style={{ padding: "4px 12px" }}>
                            End Turn
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="combat-action-console combat-action-console--waiting" style={{ padding: "8px", background: "rgba(0,0,0,0.1)", borderRadius: "6px", fontSize: "0.85rem", color: "var(--text-dim)", textAlign: "center" }}>
                    Waiting for {activeParticipant.name} to complete their turn...
                  </div>
                );
              })()}
            </div>
          )}

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
                <div className="sidebar-section-title">Combat Controller</div>
                {activeCombat ? (
                  <div className="dm-combat-status" style={{ padding: "8px", background: "rgba(184,134,11,0.05)", border: "1px solid var(--accent-gold)", borderRadius: "6px" }}>
                    <p className="status-active" style={{ fontSize: "0.85rem", color: "var(--accent-gold)", fontWeight: "bold", margin: "0 0 6px 0" }}>⚔️ Combat is Active (Round {activeCombat.round_number})</p>
                    <div className="turn-indicator" style={{ fontSize: "0.8rem", color: "var(--text-light)" }}>
                      Current Turn: <strong>{activeCombat.turn_order[activeCombat.current_turn_index]?.name}</strong>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (!ws) return;
                    ws.send(JSON.stringify({
                      type: "START_COMBAT",
                      payload: { monsters: [{ id: selectedMonster, count: monsterCount }] }
                    }));
                  }} className="dm-combat-form">
                    <div className="form-group" style={{ marginBottom: "8px" }}>
                      <label htmlFor="monster-select" style={{ fontSize: "0.8rem", color: "var(--text-dim)", display: "block", marginBottom: "4px" }}>Monster Type</label>
                      <select id="monster-select" className="input-field" value={selectedMonster} onChange={e => setSelectedMonster(e.target.value)} style={{ width: "100%", padding: "6px" }}>
                        <option value="goblin">Goblin (CR 1/4)</option>
                        <option value="kobold">Kobold (CR 1/8)</option>
                        <option value="orc">Orc (CR 1/2)</option>
                        <option value="skeleton">Skeleton (CR 1/4)</option>
                        <option value="red_dragon">Red Dragon Wyrmling (CR 4)</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: "12px" }}>
                      <label htmlFor="monster-count" style={{ fontSize: "0.8rem", color: "var(--text-dim)", display: "block", marginBottom: "4px" }}>Count (1-5)</label>
                      <input id="monster-count" type="number" className="input-field" min={1} max={5} value={monsterCount} onChange={e => setMonsterCount(parseInt(e.target.value) || 1)} style={{ width: "100%", padding: "6px" }} />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={wsStatus !== "connected"}>
                      ⚔️ Start Combat
                    </button>
                  </form>
                )}
              </div>

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
                <div className="stat-card"><div className="stat-card__val">{derivedAc}</div><div className="stat-card__lbl">AC</div></div>
                <div className="stat-card"><div className="stat-card__val">{equippedItems.length}</div><div className="stat-card__lbl">Equipped</div></div>
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
                <div className="sidebar-section-title">Skills</div>
                <div className="skill-list" role="list">
                  {(Object.entries(myCharacter.skills || {}) as Array<[string, number]>).map(([skill, bonus]) => (
                    <div key={skill} role="listitem" className="skill-row">
                      <span className="skill-row__name">{skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
                      <span className="skill-row__bonus">{Number(bonus) >= 0 ? "+" : ""}{bonus}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Quick Dice</div>
                <DicePanel onRoll={rollDice} disabled={wsStatus !== "connected"} />
              </div>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Inventory</div>
                {inventoryError && <div className="auth-message auth-message--error" role="alert">{inventoryError}</div>}
                {inventory.length === 0 ? (
                  <div className="member-list__empty">No items carried.</div>
                ) : (
                  <div className="inventory-grid">
                    {inventory.map((item) => (
                      <div key={item.id} className={`inventory-item${item.is_equipped ? " inventory-item--equipped" : ""}`}>
                        <div className="inventory-item__top">
                          <div>
                            <div className="inventory-item__name">{item.name}</div>
                            <div className="inventory-item__meta">
                              {item.type}{item.quantity > 1 ? ` x${item.quantity}` : ""}
                            </div>
                          </div>
                          {item.is_equipped && <span className="inventory-item__pill">On</span>}
                        </div>
                        <div className="inventory-item__desc">{item.description}</div>
                        <div className="inventory-item__actions">
                          {!item.is_consumable && (
                            <button className="btn btn-gold inventory-item__action" onClick={() => void toggleInventoryEquip(item)}>
                              {item.is_equipped ? "Unequip" : "Equip"}
                            </button>
                          )}
                          <button className="btn btn-danger inventory-item__action" onClick={() => void dropInventoryItem(item)}>
                            Drop
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
