import { useState } from "react";
import type { Nemesis, NemesisHistoryEntry, Faction, NemesisTier, NemesisStatus } from "@dnd/shared";
import { API_URL } from "../config";
import "./NemesisGallery.css";

interface Props {
  campaignId: string;
  token: string;
  nemeses: Nemesis[];
  factions: Faction[];
  isDM: boolean;
  onUpdate: () => void;
}

const TIER_COLORS: Record<NemesisTier, string> = {
  soldier: "#8aaa6e",
  lieutenant: "#c09a3a",
  warlord: "#c0603a",
  archnemesis: "#9b3aef",
};

const TIER_LABELS: Record<NemesisTier, string> = {
  soldier: "Soldier",
  lieutenant: "Lieutenant",
  warlord: "Warlord",
  archnemesis: "Archnemesis",
};

const STATUS_LABELS: Record<NemesisStatus, string> = {
  active: "Active",
  ambushing: "Ambushing",
  missing: "Missing",
  retired: "Retired",
  dead: "Slain",
};

const STATUS_COLORS: Record<NemesisStatus, string> = {
  active: "#6ef0a0",
  ambushing: "#f0b050",
  missing: "#a0a0a0",
  retired: "#6090c0",
  dead: "#c05060",
};

const PERSONALITY_ICONS: Record<string, string> = {
  brutal: "⚔️", cowardly: "🏃", cunning: "🎭", honorable: "🛡️",
  vengeful: "🔥", warlord: "👑", paranoid: "👁️",
};

const SCAR_ICONS: Record<string, string> = {
  blinded_eye: "👁️", severed_arm: "💪", burn_marks: "🔥",
  broken_leg: "🦴", cursed_wound: "💀",
};


export function NemesisGallery({ campaignId, token, nemeses, factions, isDM, onUpdate }: Props) {
  const [selected, setSelected] = useState<Nemesis | null>(null);
  const [history, setHistory] = useState<NemesisHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [dmNote, setDmNote] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const base = `${API_URL}/api/campaigns/${campaignId}`;

  async function openDetail(n: Nemesis) {
    setSelected(n);
    setLoadingHistory(true);
    try {
      const res = await fetch(`${base}/nemeses/${n.id}`, { headers });
      const data = await res.json();
      setHistory(data.history || []);
    } catch { /* silent */ }
    setLoadingHistory(false);
  }

  async function dmAction(endpoint: string, method = "PATCH", body?: object) {
    setActionLoading(true);
    try {
      await fetch(`${base}/nemeses/${selected!.id}/${endpoint}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
      });
      onUpdate();
      setSelected(null);
    } catch { /* silent */ }
    setActionLoading(false);
  }

  async function addNote() {
    if (!dmNote.trim() || !selected) return;
    setNoteLoading(true);
    try {
      await fetch(`${base}/nemeses/${selected.id}/history`, {
        method: "POST", headers, body: JSON.stringify({ summary: dmNote, event_type: "dm_note" }),
      });
      setDmNote("");
      const res = await fetch(`${base}/nemeses/${selected.id}`, { headers });
      const data = await res.json();
      setHistory(data.history || []);
    } catch { /* silent */ }
    setNoteLoading(false);
  }

  async function triggerAmbush() {
    if (!selected) return;
    setActionLoading(true);
    try {
      await fetch(`${base}/nemeses/${selected.id}/ambush`, { method: "POST", headers });
      onUpdate();
    } catch { /* silent */ }
    setActionLoading(false);
  }

  const factionMap = Object.fromEntries(factions.map((f) => [f.id, f]));

  const sorted = [...nemeses].sort((a, b) => {
    const order: NemesisStatus[] = ["active", "ambushing", "missing", "retired", "dead"];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  if (selected) {
    return (
      <div className="ng-detail">
        <button className="ng-back" onClick={() => setSelected(null)}>← Back to Gallery</button>

        <div className="ng-detail-header">
          <div className="ng-tier-badge" style={{ background: TIER_COLORS[selected.tier] }}>
            {TIER_LABELS[selected.tier].toUpperCase()}
          </div>
          <div className="ng-detail-title">
            <h2>{selected.name}</h2>
            {selected.epithet && <span className="ng-epithet">"{selected.epithet}"</span>}
          </div>
          <span className="ng-status-dot" style={{ background: STATUS_COLORS[selected.status] }}>
            {STATUS_LABELS[selected.status]}
          </span>
        </div>

        <div className="ng-detail-grid">
          {/* Left column — identity */}
          <div className="ng-detail-col">
            <div className="ng-section">
              <h3>Identity</h3>
              <div className="ng-stat-row"><span>Personality</span><span>{PERSONALITY_ICONS[selected.personality]} {selected.personality}</span></div>
              <div className="ng-stat-row"><span>Level</span><span>{selected.level}</span></div>
              <div className="ng-stat-row"><span>XP</span><span>{selected.xp}</span></div>
              <div className="ng-stat-row"><span>Grudge Score</span><span className="ng-grudge">🩸 {selected.grudge_score}</span></div>
              <div className="ng-stat-row"><span>Bounty on Party</span><span>💰 {selected.bounty_on_party} gp</span></div>
              {selected.faction_name && <div className="ng-stat-row"><span>Faction</span><span>⚑ {selected.faction_name}</span></div>}
              {selected.location_name && <div className="ng-stat-row"><span>Last Seen</span><span>📍 {selected.location_name}</span></div>}
              {selected.target_character_name && <div className="ng-stat-row"><span>Grudge Target</span><span>🎯 {selected.target_character_name}</span></div>}
            </div>

            <div className="ng-section">
              <h3>Combat Stats</h3>
              <div className="ng-stat-row"><span>HP Max</span><span>{selected.stats.hp_max ?? "—"}</span></div>
              <div className="ng-stat-row"><span>AC</span><span>{selected.stats.ac ?? "—"}</span></div>
              <div className="ng-stat-row"><span>Attack Bonus</span><span>+{selected.stats.attack_bonus ?? 0}</span></div>
              <div className="ng-stat-row"><span>Damage</span><span>{selected.stats.damage_dice ?? "1d6"} +{selected.stats.damage_modifier ?? 0}</span></div>
            </div>

            {selected.scars.length > 0 && (
              <div className="ng-section">
                <h3>Scars</h3>
                {selected.scars.map((scar, i) => (
                  <div key={i} className="ng-scar-item">
                    <span className="ng-scar-icon">{SCAR_ICONS[scar.type] || "⚡"}</span>
                    <div>
                      <div className="ng-scar-label">{scar.label}</div>
                      <div className="ng-scar-effect">{scar.effect}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right column — history & controls */}
          <div className="ng-detail-col">
            <div className="ng-section ng-history-section">
              <h3>History</h3>
              {loadingHistory ? (
                <div className="ng-loading">Loading...</div>
              ) : history.length === 0 ? (
                <div className="ng-empty">No encounters recorded yet.</div>
              ) : (
                <div className="ng-history-list">
                  {history.map((h) => (
                    <div key={h.id} className={`ng-history-item ng-event-${h.event_type.replace(/_/g, "-")}`}>
                      <span className="ng-history-type">{h.event_type.replace(/_/g, " ")}</span>
                      <p>{h.summary}</p>
                      <span className="ng-history-date">{new Date(h.occurred_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isDM && (
              <div className="ng-section">
                <h3>DM Controls</h3>
                <div className="ng-dm-grid">
                  <button
                    className="ng-dm-btn ng-btn-green"
                    disabled={actionLoading || selected.status === "active"}
                    onClick={() => dmAction("status", "PATCH", { status: "active" })}
                  >Reactivate</button>
                  <button
                    className="ng-dm-btn ng-btn-blue"
                    disabled={actionLoading || selected.status === "retired"}
                    onClick={() => dmAction("status", "PATCH", { status: "retired" })}
                  >Retire</button>
                  <button
                    className="ng-dm-btn ng-btn-red"
                    disabled={actionLoading || selected.status === "dead"}
                    onClick={() => dmAction("status", "PATCH", { status: "dead" })}
                  >Mark Dead</button>
                  <button
                    className="ng-dm-btn ng-btn-orange"
                    disabled={actionLoading || selected.status === "ambushing"}
                    onClick={triggerAmbush}
                  >Trigger Ambush</button>
                </div>

                <div className="ng-tier-controls">
                  <label>Set Tier:</label>
                  <div className="ng-tier-buttons">
                    {(["soldier", "lieutenant", "warlord", "archnemesis"] as NemesisTier[]).map((t) => (
                      <button
                        key={t}
                        className={`ng-tier-btn ${selected.tier === t ? "ng-tier-active" : ""}`}
                        style={{ borderColor: TIER_COLORS[t] }}
                        disabled={actionLoading || selected.tier === t}
                        onClick={() => dmAction("tier", "PATCH", { tier: t })}
                      >{TIER_LABELS[t]}</button>
                    ))}
                  </div>
                </div>

                <div className="ng-note-form">
                  <textarea
                    placeholder="Add a story note..."
                    value={dmNote}
                    onChange={(e) => setDmNote(e.target.value)}
                    rows={3}
                  />
                  <button
                    className="ng-dm-btn ng-btn-purple"
                    disabled={noteLoading || !dmNote.trim()}
                    onClick={addNote}
                  >{noteLoading ? "Saving…" : "Add Note"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ng-gallery">
      <div className="ng-gallery-header">
        <h2>⚔️ Nemesis Gallery</h2>
        <span className="ng-count">{nemeses.filter((n) => n.status === "active" || n.status === "ambushing").length} active threats</span>
      </div>

      {factions.length > 0 && (
        <div className="ng-factions-bar">
          {factions.map((f) => (
            <div key={f.id} className={`ng-faction-chip ng-faction-${f.disposition}`}>
              ⚑ {f.name} <span>Pwr {f.power_level}</span>
            </div>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="ng-empty-gallery">
          <div className="ng-empty-icon">🕯️</div>
          <p>No nemeses yet. Let an enemy survive combat…</p>
        </div>
      ) : (
        <div className="ng-card-grid">
          {sorted.map((n) => {
            const faction = n.faction_id ? factionMap[n.faction_id] : null;
            const isAlive = n.status === "active" || n.status === "ambushing" || n.status === "missing";
            return (
              <div
                key={n.id}
                className={`ng-card ${!isAlive ? "ng-card-faded" : ""}`}
                onClick={() => openDetail(n)}
              >
                <div className="ng-card-top">
                  <div className="ng-card-tier" style={{ background: TIER_COLORS[n.tier] }}>
                    {TIER_LABELS[n.tier]}
                  </div>
                  <div className="ng-card-status" style={{ color: STATUS_COLORS[n.status] }}>
                    {STATUS_LABELS[n.status]}
                  </div>
                </div>

                <div className="ng-card-identity">
                  <div className="ng-card-personality-icon">{PERSONALITY_ICONS[n.personality] || "⚔️"}</div>
                  <div>
                    <div className="ng-card-name">{n.name}</div>
                    {n.epithet && <div className="ng-card-epithet">"{n.epithet}"</div>}
                  </div>
                </div>

                <div className="ng-card-stats">
                  <div className="ng-card-stat"><span>Lvl</span><strong>{n.level}</strong></div>
                  <div className="ng-card-stat"><span>Grudge</span><strong className="ng-grudge">🩸{n.grudge_score}</strong></div>
                  <div className="ng-card-stat"><span>Bounty</span><strong>💰{n.bounty_on_party}</strong></div>
                </div>

                <div className="ng-card-xp-bar">
                  <div className="ng-xp-fill" style={{ width: `${Math.min(100, (n.xp % 100))}%` }} />
                </div>

                <div className="ng-card-footer">
                  {faction && (
                    <span className={`ng-faction-tag ng-faction-${faction.disposition}`}>⚑ {faction.name}</span>
                  )}
                  {n.target_character_name && (
                    <span className="ng-target-tag">🎯 {n.target_character_name}</span>
                  )}
                  {n.scars.length > 0 && (
                    <span className="ng-scars-tag">
                      {n.scars.slice(0, 3).map((s) => SCAR_ICONS[s.type] || "⚡").join("")}
                    </span>
                  )}
                  {n.status === "ambushing" && <span className="ng-ambush-pulse">⚠ AMBUSH</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
