import React, { useState, useEffect, useRef } from "react";
import { API_URL, WS_URL } from "./config";
import { RACES, CLASSES } from "@dnd/shared";
import type { DiceType, ServerWSMessage, Character, Campaign, ServerMessageMap, ServerMessageType } from "@dnd/shared";
import "./App.css";

interface LobbyCampaign extends Campaign {
  role: "player" | "dm";
  owner_name: string;
}

interface SystemEvent {
  id: string;
  type: "system";
  payload: { text: string };
  timestamp: string;
  actor_name?: never;
}

type GameEvent = ServerMessageMap["GAME_EVENT"];
type GameOrSystemEvent = GameEvent | SystemEvent;

interface ChatPayload {
  sender_name: string;
  text: string;
}

interface ExplorationPayload {
  roller_name: string;
  dice_type: string;
  raw: number;
  modifier: number;
  final: number;
  context: string;
}

function App() {
  // Authentication State
  const [token, setToken] = useState<string | null>(localStorage.getItem("dnd_token"));
  const [user, setUser] = useState<{ id: string; email: string; username: string } | null>(
    localStorage.getItem("dnd_user") ? JSON.parse(localStorage.getItem("dnd_user")!) : null
  );

  // Navigation & UI State
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  // Lobby & Campaigns State
  const [campaigns, setCampaigns] = useState<LobbyCampaign[]>([]);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [lobbyError, setLobbyError] = useState("");

  // Active Campaign / Room State
  const [activeCampaign, setActiveCampaign] = useState<LobbyCampaign | null>(null);
  const [activeRole, setActiveRole] = useState<"player" | "dm" | null>(null);
  const [partyCharacters, setPartyCharacters] = useState<Character[]>([]);
  const [myCharacter, setMyCharacter] = useState<Character | null>(null);
  const [eventLogs, setEventLogs] = useState<GameOrSystemEvent[]>([]);
  const [chatMessage, setChatMessage] = useState("");
  
  // Character Creator State
  const [charName, setCharName] = useState("");
  const [charRace, setCharRace] = useState<string>(RACES[0]);
  const [charClass, setCharClass] = useState<string>(CLASSES[0]);
  const [charError, setCharError] = useState("");

  // Dice Roller State
  const [diceModifier, setDiceModifier] = useState<number>(0);

  // WebSocket reference
  const [ws, setWs] = useState<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Helper for authenticated API calls
  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };
    const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed with status ${res.status}`);
    }
    return data;
  };

  const handleLogout = () => {
    localStorage.removeItem("dnd_token");
    localStorage.removeItem("dnd_user");
    setToken(null);
    setUser(null);
    setActiveCampaign(null);
  };

  const fetchCampaigns = async () => {
    try {
      const data = await apiFetch("/api/campaigns");
      setCampaigns(data.campaigns || []);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unauthorized") || msg.includes("invalid token")) {
        handleLogout();
      }
    }
  };

  const fetchPartyCharacters = async (campaignId: string) => {
    try {
      const data = await apiFetch(`/api/characters/campaign/${campaignId}`);
      const chars = data.characters || [];
      setPartyCharacters(chars);

      // Find my character in this campaign
      const myChar = chars.find((c: Character) => c.user_id === user?.id);
      if (myChar) {
        setMyCharacter(myChar);
      } else {
        setMyCharacter(null);
      }
    } catch (err) {
      console.error("Error fetching party characters:", err);
    }
  };

  // Load user campaigns when token is set
  useEffect(() => {
    if (token) {
      setTimeout(() => {
        fetchCampaigns();
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Scroll to bottom of chat when new logs arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLogs]);

  // WebSocket Connection Handler
  useEffect(() => {
    if (!activeCampaign || !token || !user) {
      return;
    }

    const socket = new WebSocket(`${WS_URL}?token=${token}`);
    setTimeout(() => {
      setWs(socket);
    }, 0);

    socket.onopen = () => {
      console.log("WebSocket connection established");
      // Join the campaign room
      socket.send(
        JSON.stringify({
          type: "JOIN_CAMPAIGN",
          payload: { invite_code: activeCampaign.invite_code },
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerWSMessage<ServerMessageType>;
        console.log("WebSocket event received:", message);

        switch (message.type) {
          case "PLAYER_JOINED": {
            const { user_id, username, character } = message.payload as {
              user_id: string;
              username: string;
              character?: Character | null;
            };
            
            // Add system log entry
            setEventLogs((prev) => [
              ...prev,
              {
                id: Math.random().toString(),
                type: "system",
                payload: { text: `${username} entered the campaign room.` },
                timestamp: new Date().toISOString(),
              },
            ]);

            // Refresh campaign party
            fetchPartyCharacters(activeCampaign.id);

            // If player is current user and character is found, set my character
            if (user_id === user.id) {
              setMyCharacter(character || null);
            }
            break;
          }

          case "PLAYER_LEFT": {
            const { username } = message.payload as { username: string };
            setEventLogs((prev) => [
              ...prev,
              {
                id: Math.random().toString(),
                type: "system",
                payload: { text: `${username} left the campaign room.` },
                timestamp: new Date().toISOString(),
              },
            ]);
            break;
          }

          case "GAME_EVENT": {
            const gameEvent = message.payload as GameEvent;
            setEventLogs((prev) => [...prev, gameEvent]);
            break;
          }

          case "DICE_RESULT": {
            // Server broadcasts DICE_RESULT but also publishes a GAME_EVENT for persistence.
            // Relying on GAME_EVENT prevents double roll cards rendering.
            break;
          }

          case "ERROR": {
            const errorPayload = message.payload as { code: string; message: string };
            alert(`Error: ${errorPayload.message}`);
            break;
          }
        }
      } catch (err) {
        console.error("Error reading WebSocket payload:", err);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket connection closed");
      setWs(null);
    };

    return () => {
      socket.close();
      setWs(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign, token]);

  // Auth Operations
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setLoading(true);

    try {
      if (activeTab === "login") {
        const data = await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        localStorage.setItem("dnd_token", data.session.access_token);
        localStorage.setItem("dnd_user", JSON.stringify(data.user));
        setToken(data.session.access_token);
        setUser(data.user);
      } else {
        await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, username }),
        });
        alert("Registration complete! Please log in.");
        setActiveTab("login");
        setPassword("");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setAuthError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Campaign Actions
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setLobbyError("");
    if (!newCampaignName.trim()) return;

    try {
      await apiFetch("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name: newCampaignName }),
      });
      setNewCampaignName("");
      fetchCampaigns();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create campaign";
      setLobbyError(msg);
    }
  };

  const handleJoinCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setLobbyError("");
    if (!inviteCodeInput.trim()) return;

    try {
      const data = await apiFetch("/api/campaigns/join", {
        method: "POST",
        body: JSON.stringify({ invite_code: inviteCodeInput }),
      });
      setInviteCodeInput("");
      fetchCampaigns();
      
      // Instantly open the newly joined campaign
      handleEnterCampaign(data.campaign, data.role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join campaign";
      setLobbyError(msg);
    }
  };

  const handleEnterCampaign = (campaign: LobbyCampaign, role: "player" | "dm") => {
    setEventLogs([]);
    setActiveCampaign(campaign);
    setActiveRole(role);
    fetchPartyCharacters(campaign.id);
  };

  // Character Creator
  const handleCreateCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    setCharError("");
    if (!charName.trim() || !activeCampaign) return;

    try {
      const data = await apiFetch("/api/characters", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: activeCampaign.id,
          name: charName,
          race: charRace,
          class: charClass,
        }),
      });

      setCharName("");
      setMyCharacter(data.character);
      fetchPartyCharacters(activeCampaign.id);

      // Re-trigger join room event over socket to update character mapping
      if (ws) {
        ws.send(
          JSON.stringify({
            type: "JOIN_CAMPAIGN",
            payload: { invite_code: activeCampaign.invite_code },
          })
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create character";
      setCharError(msg);
    }
  };

  // WebSocket client-to-server operations
  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !ws) return;

    ws.send(
      JSON.stringify({
        type: "CHAT_MESSAGE",
        payload: { text: chatMessage },
      })
    );
    setChatMessage("");
  };

  const rollAttribute = (attrName: string, score: number) => {
    if (!ws || !myCharacter) return;
    
    // D&D attribute modifier formula: Math.floor((score - 10) / 2)
    const modifier = Math.floor((score - 10) / 2);

    ws.send(
      JSON.stringify({
        type: "DICE_REQUEST",
        payload: {
          dice_type: "d20",
          context: `roll:${attrName.toUpperCase()}`,
          modifier: modifier,
        },
      })
    );
  };

  const rollQuickDice = (dice: DiceType) => {
    if (!ws) return;
    ws.send(
      JSON.stringify({
        type: "DICE_REQUEST",
        payload: {
          dice_type: dice,
          context: "Quick Dice Roll",
          modifier: diceModifier,
        },
      })
    );
  };

  // Render Auth UI if not logged in
  if (!token || !user) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1 className="dnd-font">Ironhammer D&D</h1>
          <div className="auth-tabs">
            <button
              className={`auth-tab ${activeTab === "login" ? "active" : ""}`}
              onClick={() => setActiveTab("login")}
            >
              LOG IN
            </button>
            <button
              className={`auth-tab ${activeTab === "register" ? "active" : ""}`}
              onClick={() => setActiveTab("register")}
            >
              REGISTER
            </button>
          </div>

          {authError && <div className="auth-error">{authError}</div>}

          <form onSubmit={handleAuth}>
            {activeTab === "register" && (
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                className="input-field"
                placeholder="Enter email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                className="input-field"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "10px" }} disabled={loading}>
              {loading ? "Processing..." : activeTab === "login" ? "Log In" : "Sign Up"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render Campaign Game Arena if in an active campaign
  if (activeCampaign) {
    return (
      <div className="game-container">
        <header className="game-header">
          <div className="game-title">
            <button className="btn" onClick={() => setActiveCampaign(null)}>
              ← Back to Lobby
            </button>
            <h2>{activeCampaign.name}</h2>
            <div 
              className="game-invite-pill" 
              onClick={() => {
                navigator.clipboard.writeText(activeCampaign.invite_code);
                alert("Invite code copied to clipboard!");
              }}
              title="Click to copy invite code"
            >
              Invite Code: <span className="invite-code">{activeCampaign.invite_code}</span>
            </div>
          </div>
          <div>
            <span style={{ marginRight: "15px", textTransform: "capitalize" }}>
              Role: <span className={`role-badge ${activeRole}`}>{activeRole}</span>
            </span>
            <button className="btn btn-danger" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <div className="game-layout">
          {/* Left Sidebar: Members & Party */}
          <aside className="sidebar-left">
            <div className="sidebar-section-title">Campaign Party</div>
            <div className="member-list">
              {partyCharacters.map((char) => (
                <div key={char.id} className="member-item">
                  <div className="member-user-row">
                    <span>{char.name}</span>
                    <span className="role-badge player">Lv.{char.level}</span>
                  </div>
                  <div className="member-char-name">
                    {char.race} {char.class}
                  </div>
                </div>
              ))}
              {partyCharacters.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontStyle: "italic" }}>
                  No characters created yet.
                </div>
              )}
            </div>
          </aside>

          {/* Center Column: Live Chat & Narrative */}
          <main className="chat-column">
            <div className="chat-log">
              {eventLogs.map((log) => {
                if (log.type === "system") {
                  const systemPayload = log.payload as { text: string };
                  return (
                    <div key={log.id} className="chat-event-card system">
                      <div className="event-text">{systemPayload.text}</div>
                    </div>
                  );
                }

                if (log.type === "chat") {
                  const chatPayload = log.payload as ChatPayload;
                  return (
                    <div key={log.id} className="chat-event-card chat">
                      <div className="event-header">
                        <span className="event-sender">{log.actor_name || chatPayload.sender_name || "Player"}</span>
                        <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="event-text">{chatPayload.text}</div>
                    </div>
                  );
                }

                if (log.type === "exploration") {
                  const rollPayload = log.payload as ExplorationPayload;
                  return (
                    <div key={log.id} className="chat-event-card exploration">
                      <div className="event-header">
                        <span className="event-sender">{log.actor_name || rollPayload.roller_name || "Player"}</span>
                        <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="event-text">
                        Rolled a skill check: <span style={{ color: "var(--accent-gold)", fontWeight: "bold" }}>{rollPayload.context}</span>
                        <div className="dice-bubble-container">
                          <div className="dice-icon-roll">d{rollPayload.dice_type.substring(1)}</div>
                          <div className="dice-details">
                            Roll: {rollPayload.raw} | Mod: {rollPayload.modifier >= 0 ? `+${rollPayload.modifier}` : rollPayload.modifier}
                          </div>
                          <div className="dice-total">{rollPayload.final}</div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={sendChatMessage} className="chat-input-bar">
              <input
                type="text"
                className="input-field"
                placeholder="Type a message or describe your action..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary">
                Send
              </button>
            </form>
          </main>

          {/* Right Sidebar: Character Panel / Creator */}
          <aside className="sidebar-right">
            {activeRole === "dm" ? (
              <div className="creator-container">
                <h3 className="dnd-font">DM Panel</h3>
                <div style={{ textAlign: "center", color: "var(--accent-gold)", marginBottom: "20px" }}>
                  ♛ You are the Dungeon Master
                </div>
                <p style={{ fontSize: "0.9rem", lineHeight: "1.6", color: "var(--text-muted)" }}>
                  As DM, you oversee the campaign. Monitor character actions, narrate story segments, and challenge players with encounters in real time.
                </p>
                <div style={{ marginTop: "30px", borderTop: "1px solid var(--bg-panel)", paddingTop: "20px" }}>
                  <div className="sidebar-section-title">Quick Dice Rolls</div>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "15px" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Modifier:</label>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: "70px", padding: "4px 8px", textAlign: "center", margin: 0 }}
                      value={diceModifier}
                      onChange={(e) => setDiceModifier(parseInt(e.target.value, 10) || 0)}
                    />
                    <button 
                      className="btn" 
                      style={{ padding: "4px 8px", fontSize: "0.85rem" }} 
                      onClick={() => setDiceModifier(0)}
                    >
                      Clear
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d4")}>D4</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d6")}>D6</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d8")}>D8</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d10")}>D10</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d12")}>D12</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d20")}>D20</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem", gridColumn: "span 2" }} onClick={() => rollQuickDice("d100")}>D100</button>
                  </div>
                </div>
              </div>
            ) : myCharacter ? (
              <div className="sheet-container animate-fade-in">
                <div className="sheet-header">
                  <h3 className="sheet-name">{myCharacter.name}</h3>
                  <span className="sheet-meta">
                    Level {myCharacter.level} | {myCharacter.race} {myCharacter.class}
                  </span>
                </div>

                <div className="hp-bar-container">
                  <div className="hp-bar-label">
                    <span>HIT POINTS</span>
                    <span>{myCharacter.hp_current} / {myCharacter.hp_max}</span>
                  </div>
                  <div className="hp-bar-bg">
                    <div 
                      className="hp-bar-fill" 
                      style={{ width: `${(myCharacter.hp_current / myCharacter.hp_max) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="sheet-info-grid">
                  <div className="sheet-info-card">
                    <div className="sheet-info-val">{myCharacter.xp}</div>
                    <div className="sheet-info-lbl">XP</div>
                  </div>
                  <div className="sheet-info-card">
                    <div className="sheet-info-val">{myCharacter.gold}g</div>
                    <div className="sheet-info-lbl">Gold</div>
                  </div>
                </div>

                <div className="sidebar-section-title">Attributes (Click to Roll)</div>
                <div className="attributes-list">
                  {Object.entries(myCharacter.attributes).map(([attr, score]) => {
                    const scoreNum = Number(score);
                    const modifier = Math.floor((scoreNum - 10) / 2);
                    const modSign = modifier >= 0 ? `+${modifier}` : modifier;

                    return (
                      <div 
                        key={attr} 
                        className="attribute-row" 
                        onClick={() => rollAttribute(attr, scoreNum)}
                        style={{ cursor: "pointer" }}
                        title={`Click to roll d20 check with ${attr.toUpperCase()}`}
                      >
                        <div className="attribute-info">
                          <span className="attribute-abbv">{attr.toUpperCase()}</span>
                          <span className="attribute-score">{scoreNum}</span>
                        </div>
                        <span className="attribute-mod">{modSign}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: "20px", borderTop: "1px solid var(--bg-panel)", paddingTop: "15px" }}>
                  <div className="sidebar-section-title">Quick Dice Rolls</div>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "15px" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Modifier:</label>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: "70px", padding: "4px 8px", textAlign: "center", margin: 0 }}
                      value={diceModifier}
                      onChange={(e) => setDiceModifier(parseInt(e.target.value, 10) || 0)}
                    />
                    <button 
                      className="btn" 
                      style={{ padding: "4px 8px", fontSize: "0.85rem" }} 
                      onClick={() => setDiceModifier(0)}
                    >
                      Clear
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d4")}>D4</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d6")}>D6</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d8")}>D8</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d10")}>D10</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d12")}>D12</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem" }} onClick={() => rollQuickDice("d20")}>D20</button>
                    <button className="btn btn-gold" style={{ padding: "6px 0", fontSize: "0.85rem", gridColumn: "span 2" }} onClick={() => rollQuickDice("d100")}>D100</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="creator-container animate-fade-in">
                <h3 className="dnd-font">Create Character</h3>
                {charError && <div className="auth-error">{charError}</div>}
                
                <form onSubmit={handleCreateCharacter}>
                  <div className="form-group">
                    <label>Character Name</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Thorin Oakshield"
                      value={charName}
                      onChange={(e) => setCharName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Race</label>
                    <select
                      className="input-field"
                      value={charRace}
                      onChange={(e) => setCharRace(e.target.value)}
                    >
                      {RACES.map((race) => (
                        <option key={race} value={race}>{race}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Class</label>
                    <select
                      className="input-field"
                      value={charClass}
                      onChange={(e) => setCharClass(e.target.value)}
                    >
                      {CLASSES.map((cls) => (
                        <option key={cls} value={cls}>{cls}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "15px" }}>
                    Spawn Character
                  </button>
                </form>
              </div>
            )}
          </aside>
        </div>
      </div>
    );
  }

  // Render Lobby Dashboard by default (when authenticated)
  return (
    <div className="lobby-container">
      <header className="lobby-header">
        <div className="lobby-user-info">
          <div className="lobby-avatar">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.4rem" }}>{user.username}</h2>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{user.email}</span>
          </div>
        </div>
        <button className="btn btn-danger" onClick={handleLogout}>
          Logout
        </button>
      </header>

      {lobbyError && <div className="auth-error" style={{ maxWidth: "100%" }}>{lobbyError}</div>}

      <div className="lobby-grid">
        {/* Left Side: Campaigns list */}
        <section className="lobby-section">
          <h2>Active Campaigns</h2>
          <div className="campaign-grid">
            {campaigns.map((camp: LobbyCampaign) => (
              <div key={camp.id} className="campaign-card">
                <div>
                  <h3>{camp.name}</h3>
                  <div className="meta">
                    DM: {camp.owner_name}
                  </div>
                  <div className="meta">
                    Invite Code: <span className="invite-code">{camp.invite_code}</span>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className={`role-badge ${camp.role}`}>{camp.role}</span>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleEnterCampaign(camp, camp.role)}
                  >
                    Enter Room
                  </button>
                </div>
              </div>
            ))}
            {campaigns.length === 0 && (
              <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                You are not part of any campaigns. Create one or join using an invite code!
              </div>
            )}
          </div>
        </section>

        {/* Right Side: Create/Join panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: "25px" }}>
          <section className="lobby-section">
            <h2>Join Campaign</h2>
            <form onSubmit={handleJoinCampaign}>
              <div className="form-group">
                <label>Invite Code</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Enter invite code"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
                Join Campaign Room
              </button>
            </form>
          </section>

          <section className="lobby-section">
            <h2>New Campaign</h2>
            <form onSubmit={handleCreateCampaign}>
              <div className="form-group">
                <label>Campaign Name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Enter campaign name"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-gold" style={{ width: "100%" }}>
                Create Campaign Room
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
