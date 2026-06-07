import React, { useState } from "react";
import { useGameStore } from "../stores/gameStore";

interface FactionControlRoomProps {
  onClose: () => void;
}

export const FactionControlRoom: React.FC<FactionControlRoomProps> = ({ onClose }) => {
  const {
    activeCampaign,
    factions,
    relations,
    factionActions,
    factionEnginePaused,
    ws,
    setFactionEnginePaused,
  } = useGameStore();

  const [activeTab, setActiveTab] = useState<"factions" | "diplomacy" | "actions">("factions");

  // Force Action Form State
  const [selectedFactionId, setSelectedFactionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<string>("patrol");
  const [targetType, setTargetType] = useState<"location" | "npc" | "faction" | "trade_route" | "player">("location");
  const [targetId, setTargetId] = useState<string>("");

  if (!activeCampaign) return null;

  const handlePauseToggle = () => {
    if (!ws) return;
    const nextPaused = !factionEnginePaused;
    ws.send(
      JSON.stringify({
        type: "PAUSE_FACTION_ENGINE",
        payload: { pause: nextPaused },
      })
    );
    setFactionEnginePaused(nextPaused);
  };

  const handleManualCycle = () => {
    if (!ws) return;
    ws.send(
      JSON.stringify({
        type: "TRIGGER_FACTION_EVENT",
        payload: { faction_id: "", event_type: "cycle" },
      })
    );
  };

  const handleVeto = (actionId: string) => {
    if (!ws) return;
    ws.send(
      JSON.stringify({
        type: "VETO_FACTION_ACTION",
        payload: { action_id: actionId },
      })
    );
  };

  const handleForceActionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws || !selectedFactionId || !targetId) return;

    ws.send(
      JSON.stringify({
        type: "FORCE_FACTION_ACTION",
        payload: {
          faction_id: selectedFactionId,
          action_type: actionType,
          target_type: targetType,
          target_id: targetId,
        },
      })
    );

    // Reset state
    setSelectedFactionId(null);
    setTargetId("");
  };

  // Build a tree of actions to represent cascades
  const pendingActions = factionActions.filter((a) => a.status === "pending");

  // Get relation score between two factions
  const getRelationScore = (fA: string, fB: string) => {
    const rel = relations.find(
      (r) =>
        (r.faction_a_id === fA && r.faction_b_id === fB) ||
        (r.faction_a_id === fB && r.faction_b_id === fA)
    );
    return rel ? { score: rel.score, treaty: rel.treaty_type } : { score: 0, treaty: "none" };
  };

  return (
    <div className="faction-control-modal-overlay">
      <div className="faction-control-modal animate-scale-up">
        {/* Header */}
        <header className="faction-modal-header">
          <div className="faction-modal-title-wrap">
            <h2 className="faction-modal-title">🏰 Faction Control Room</h2>
            <p className="faction-modal-subtitle">Campaign: {activeCampaign.name} &bull; DM Override Console</p>
          </div>
          <button className="faction-modal-close" onClick={onClose}>&times;</button>
        </header>

        {/* Global engine controls */}
        <div className="faction-engine-controls">
          <div className="engine-status-indicator">
            <span className={`status-dot ${factionEnginePaused ? "paused" : "running"}`}></span>
            <span className="status-text">
              Simulation Engine: <strong>{factionEnginePaused ? "PAUSED" : "ACTIVE"}</strong>
            </span>
          </div>
          <div className="engine-btn-group">
            <button className={`btn ${factionEnginePaused ? "btn-success" : "btn-warning"}`} onClick={handlePauseToggle}>
              {factionEnginePaused ? "▶️ Resume Heartbeat" : "⏸️ Pause Heartbeat"}
            </button>
            <button className="btn btn-primary" onClick={handleManualCycle}>
              ⚡ Force Heartbeat Cycle
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="faction-modal-tabs">
          <button className={`faction-tab-btn ${activeTab === "factions" ? "active" : ""}`} onClick={() => setActiveTab("factions")}>
            🛡️ Factions Roster
          </button>
          <button className={`faction-tab-btn ${activeTab === "diplomacy" ? "active" : ""}`} onClick={() => setActiveTab("diplomacy")}>
            🤝 Diplomacy Matrix
          </button>
          <button className={`faction-tab-btn ${activeTab === "actions" ? "active" : ""}`} onClick={() => setActiveTab("actions")}>
            ⚔️ Pending Actions &amp; Cascades ({pendingActions.length})
          </button>
        </nav>

        {/* Tab Contents */}
        <div className="faction-modal-body">
          {activeTab === "factions" && (
            <div className="factions-tab-content">
              <div className="factions-grid">
                {factions.map((faction) => {
                  const hpPct = faction.stability;
                  return (
                    <div key={faction.id} className={`faction-panel-card ${faction.collapsed ? "collapsed" : ""}`}>
                      <div className="faction-card-header">
                        <div>
                          <h3 className="faction-card-name">{faction.name}</h3>
                          <span className={`faction-card-type-badge ${faction.type}`}>{faction.type.toUpperCase()}</span>
                        </div>
                        {faction.is_hidden && <span className="secret-indicator">🕵️ SECRET</span>}
                      </div>

                      <p className="faction-card-desc">{faction.description || "No description provided."}</p>

                      <div className="faction-stats-bars">
                        <div className="stat-bar-group">
                          <label>⚔️ Military: {faction.military}</label>
                          <div className="bar-bg"><div className="bar-fill military" style={{ width: `${Math.min(100, (faction.military / 300) * 100)}%` }} /></div>
                        </div>

                        <div className="stat-bar-group">
                          <label>💰 Wealth: {faction.wealth}</label>
                          <div className="bar-bg"><div className="bar-fill wealth" style={{ width: `${Math.min(100, (faction.wealth / 300) * 100)}%` }} /></div>
                        </div>

                        <div className="stat-bar-group">
                          <label>📢 Influence: {faction.influence}</label>
                          <div className="bar-bg"><div className="bar-fill influence" style={{ width: `${Math.min(100, (faction.influence / 300) * 100)}%` }} /></div>
                        </div>

                        <div className="stat-bar-group">
                          <label>🛡️ Stability: {faction.stability}%</label>
                          <div className="bar-bg"><div className="bar-fill stability" style={{ width: `${hpPct}%` }} /></div>
                        </div>

                        <div className="stat-bar-group">
                          <label>⚡ Pressure: {faction.pressure} / {faction.pressure_cap}</label>
                          <div className="bar-bg"><div className="bar-fill pressure" style={{ width: `${Math.min(100, (faction.pressure / faction.pressure_cap) * 100)}%` }} /></div>
                        </div>
                      </div>

                      <div className="faction-card-footer">
                        <span className="territory-count">📍 Territories Claimed: {faction.territories}</span>
                        {!faction.collapsed && (
                          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedFactionId(faction.id)}>
                            💥 Force Action
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Force Action Modal */}
              {selectedFactionId && (
                <div className="force-action-overlay">
                  <div className="force-action-form-card animate-scale-up">
                    <h4>Force Faction Action</h4>
                    <p className="force-desc">Execute an immediate action bypassing engine timers, costs, and cooldowns.</p>
                    <form onSubmit={handleForceActionSubmit}>
                      <div className="form-group">
                        <label>Action Type</label>
                        <select className="input-field" value={actionType} onChange={(e) => setActionType(e.target.value)}>
                          <option value="patrol">Patrol Location (+Control, +Stability)</option>
                          <option value="raid">Raid Location (+Wealth, -Target Stability)</option>
                          <option value="siege">Siege Location (Major Control gain, -Stability)</option>
                          <option value="invade">Invade Location (Annex Territory)</option>
                          <option value="fortify">Fortify Location (+Stability)</option>
                          <option value="recruit">Recruit (+Military)</option>
                          <option value="bribe_official">Bribe Official (+Influence)</option>
                          <option value="fund_trade_route">Fund Trade Route (+Wealth)</option>
                          <option value="create_shortage">Create Shortage (+Wealth, -Target Stability)</option>
                          <option value="price_manipulation">Price Manipulation (+Wealth)</option>
                          <option value="corrupt_governor">Corrupt Governor (+Influence)</option>
                          <option value="replace_mayor">Replace Mayor (+Influence)</option>
                          <option value="pass_law">Pass Law (+Influence)</option>
                          <option value="assassination">Assassination (-Target NPC)</option>
                          <option value="blackmail">Blackmail (+Influence)</option>
                          <option value="spy_network">Spy Network (+Influence)</option>
                          <option value="sabotage">Sabotage Location (-Target Stability)</option>
                          <option value="convert_citizens">Convert Citizens (+Influence)</option>
                          <option value="build_temple">Build Temple (+Influence, +Stability)</option>
                          <option value="declare_holy_war">Declare Holy War (War relation shift)</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Target Type</label>
                        <select className="input-field" value={targetType} onChange={(e) => setTargetType(e.target.value as "location" | "npc" | "faction" | "trade_route" | "player")}>
                          <option value="location">Location</option>
                          <option value="npc">NPC</option>
                          <option value="faction">Faction</option>
                          <option value="trade_route">Trade Route</option>
                          <option value="player">Player</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Target UUID</label>
                        <input type="text" className="input-field" placeholder="Target UUID (from DB or game console)" value={targetId} onChange={(e) => setTargetId(e.target.value)} required />
                      </div>

                      <div className="btn-group-right">
                        <button type="button" className="btn btn-ghost" onClick={() => setSelectedFactionId(null)}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Launch Action</button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "diplomacy" && (
            <div className="diplomacy-tab-content">
              <div className="diplomacy-scroll-container">
                <table className="diplomacy-matrix">
                  <thead>
                    <tr>
                      <th>Faction</th>
                      {factions.map((f) => (
                        <th key={f.id}>{f.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {factions.map((fA) => (
                      <tr key={fA.id}>
                        <td className="faction-row-header">{fA.name}</td>
                        {factions.map((fB) => {
                          if (fA.id === fB.id) {
                            return <td key={fB.id} className="matrix-cell-self">&mdash;</td>;
                          }

                          const relInfo = getRelationScore(fA.id, fB.id);
                          let treatyLabel = "";
                          if (relInfo.treaty !== "none") {
                            treatyLabel = `[${relInfo.treaty.toUpperCase()}]`;
                          }

                          let cellClass = "matrix-cell-neutral";
                          if (relInfo.score > 20) cellClass = "matrix-cell-friendly";
                          if (relInfo.score < -20) cellClass = "matrix-cell-hostile";

                          return (
                            <td key={fB.id} className={`matrix-cell ${cellClass}`}>
                              <div className="score-val">{relInfo.score}</div>
                              {treatyLabel && <div className="treaty-val">{treatyLabel}</div>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "actions" && (
            <div className="actions-tab-content">
              {pendingActions.length === 0 ? (
                <div className="no-pending-actions">
                  <p>✨ No pending actions currently queued. Next heartbeat cycle will automatically select actions.</p>
                </div>
              ) : (
                <div className="actions-tree-container">
                  <h4 className="actions-queue-title">Pending Action Queue</h4>
                  {pendingActions.map((action) => {
                    const factName = factions.find((f) => f.id === action.faction_id)?.name ?? "Faction";
                    const isCascade = action.parent_action_id;

                    return (
                      <div key={action.id} className={`action-tree-node ${isCascade ? "cascade-node" : ""}`}>
                        <div className="node-icon">{isCascade ? "↳ 💥" : "🛡️"}</div>
                        <div className="node-content">
                          <div className="node-header">
                            <span className="node-faction">{factName}</span>
                            <span className="node-action-badge">{action.action_type.toUpperCase()}</span>
                            {isCascade && <span className="node-cascade-badge">CASCADE (Depth {action.parent_action_id ? "Linked" : ""})</span>}
                          </div>
                          <p className="node-details">
                            Target Type: <strong>{action.target_type.toUpperCase()}</strong> &bull; Target ID: <code>{action.target_id}</code>
                          </p>
                          <div className="node-footer">
                            <span className="node-cost">Pressure Cost: {action.pressure_cost} PP</span>
                            <button className="btn btn-danger btn-sm" onClick={() => handleVeto(action.id)}>Veto Action</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
