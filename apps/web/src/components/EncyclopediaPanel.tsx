import { useState, useEffect, useCallback } from "react";
import { API_URL } from "../config";
import "./EncyclopediaPanel.css";

interface EncyclopediaEntry {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  summary?: string;
  full_content: Record<string, unknown>;
  tags: string[];
  is_secret: boolean;
  pinned: boolean;
  importance: number;
  custom_lore?: string;
  dm_notes?: string;
}

interface Rumor {
  id: string;
  entry_id: string;
  content: string;
  reliability: number;
  source_type: string;
  resolved: boolean;
  is_true?: boolean;
  created_at: string;
}

interface HistoricalEra {
  id: string;
  name: string;
  start_year: number;
  end_year?: number;
  description?: string;
  color_theme?: string;
}

interface SessionRecord {
  id: string;
  session_number: number;
  session_date?: string;
  ai_summary?: string;
  dm_notes?: string;
  summary_approved: boolean;
}

type PanelTab = "entries" | "rumors" | "timeline" | "sessions";
type Category = "all" | "location" | "npc" | "faction" | "item" | "artifact" | "event" | "lore";

interface EncyclopediaPanelProps {
  campaignId: string;
  token: string;
  isDM: boolean;
}

const CATEGORY_ICONS: Record<string, string> = {
  location: "🗺️",
  npc: "👤",
  faction: "⚔️",
  item: "🗡️",
  artifact: "✨",
  event: "📜",
  lore: "📖",
};

const RELIABILITY_COLOR = (r: number) => {
  if (r >= 80) return "#4ade80";
  if (r >= 50) return "#facc15";
  if (r >= 20) return "#fb923c";
  return "#f87171";
};

export function EncyclopediaPanel({ campaignId, token, isDM }: EncyclopediaPanelProps) {
  const [tab, setTab] = useState<PanelTab>("entries");
  const [entries, setEntries] = useState<EncyclopediaEntry[]>([]);
  const [rumors, setRumors] = useState<Rumor[]>([]);
  const [eras, setEras] = useState<HistoricalEra[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<EncyclopediaEntry | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const apiFetch = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed ${res.status}`);
    return data;
  }, [token]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const catParam = category !== "all" ? `?category=${category}` : "";
      const data = await apiFetch(`/api/campaigns/${campaignId}/encyclopedia${catParam}`);
      setEntries(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load encyclopedia");
    } finally {
      setLoading(false);
    }
  }, [campaignId, category, apiFetch]);

  const fetchRumors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch(`/api/campaigns/${campaignId}/encyclopedia/rumors`);
      setRumors(data.rumors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rumors");
    } finally {
      setLoading(false);
    }
  }, [campaignId, apiFetch]);

  const fetchEras = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/campaigns/${campaignId}/encyclopedia/eras`);
      setEras(data.eras ?? []);
    } catch { /* silent */ }
  }, [campaignId, apiFetch]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/campaigns/${campaignId}/sessions`);
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [campaignId, apiFetch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (tab === "entries") fetchEntries();
      else if (tab === "rumors") fetchRumors();
      else if (tab === "timeline") fetchEras();
      else if (tab === "sessions") fetchSessions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab, fetchEntries, fetchRumors, fetchEras, fetchSessions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (tab === "entries") fetchEntries();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [category, tab, fetchEntries]);

  const handleSearch = async () => {
    if (!search.trim()) { fetchEntries(); return; }
    setLoading(true);
    try {
      const data = await apiFetch(`/api/campaigns/${campaignId}/encyclopedia/search?q=${encodeURIComponent(search)}`);
      setEntries(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResolveRumor = async (rumorId: string, isTrue: boolean) => {
    try {
      await apiFetch(`/api/campaigns/${campaignId}/rumors/${rumorId}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ is_true: isTrue }),
      });
      setRumors((prev) => prev.map((r) => r.id === rumorId ? { ...r, resolved: true, is_true: isTrue } : r));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve rumor");
    }
  };

  const handleSummarizeSession = async (sessionId: string) => {
    try {
      await apiFetch(`/api/campaigns/${campaignId}/sessions/${sessionId}/summarize`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start summarization");
    }
  };

  const handleApproveSession = async (sessionId: string) => {
    try {
      await apiFetch(`/api/campaigns/${campaignId}/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ summary_approved: true }),
      });
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, summary_approved: true } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve session");
    }
  };

  const filteredEntries = entries.filter((e) =>
    !search || e.title.toLowerCase().includes(search.toLowerCase()) || e.summary?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="encyclopedia-panel">
      {/* Header */}
      <div className="encyclopedia-header">
        <div className="encyclopedia-header__title">
          <span className="encyclopedia-icon">📚</span>
          <h2>World Encyclopedia</h2>
        </div>
        <div className="encyclopedia-tabs">
          {(["entries", "rumors", "timeline", "sessions"] as PanelTab[]).map((t) => (
            <button
              key={t}
              className={`encyclopedia-tab ${tab === t ? "encyclopedia-tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "entries" && "📖 Entries"}
              {t === "rumors" && "🗣️ Rumors"}
              {t === "timeline" && "⏳ Timeline"}
              {t === "sessions" && "🎲 Sessions"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="encyclopedia-error" role="alert">{error}</div>}

      {/* Entries Tab */}
      {tab === "entries" && (
        <div className="encyclopedia-body">
          <div className="encyclopedia-controls">
            <div className="encyclopedia-search">
              <input
                className="encyclopedia-search-input"
                type="text"
                placeholder="Search entries..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button className="btn-encyclopedia-search" onClick={handleSearch}>🔍</button>
            </div>
            <div className="encyclopedia-category-filter">
              {(["all", "location", "npc", "faction", "item", "artifact", "event", "lore"] as Category[]).map((cat) => (
                <button
                  key={cat}
                  className={`category-chip ${category === cat ? "category-chip--active" : ""}`}
                  onClick={() => setCategory(cat)}
                >
                  {cat === "all" ? "All" : `${CATEGORY_ICONS[cat]} ${cat}`}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="encyclopedia-loading">
              <div className="encyclopedia-spinner" />
              <span>Loading entries...</span>
            </div>
          ) : (
            <div className="encyclopedia-grid">
              {filteredEntries.length === 0 ? (
                <div className="encyclopedia-empty">
                  <span>📜</span>
                  <p>No entries discovered yet.<br/>The world awaits exploration.</p>
                </div>
              ) : (
                filteredEntries.map((entry) => (
                  <button
                    key={entry.id}
                    className={`encyclopedia-card ${entry.pinned ? "encyclopedia-card--pinned" : ""} ${selectedEntry?.id === entry.id ? "encyclopedia-card--selected" : ""}`}
                    onClick={() => setSelectedEntry(selectedEntry?.id === entry.id ? null : entry)}
                  >
                    <div className="encyclopedia-card__header">
                      <span className="encyclopedia-card__icon">{CATEGORY_ICONS[entry.category] ?? "📄"}</span>
                      <div className="encyclopedia-card__titles">
                        <span className="encyclopedia-card__title">{entry.title}</span>
                        {entry.subtitle && <span className="encyclopedia-card__subtitle">{entry.subtitle}</span>}
                      </div>
                      {entry.pinned && <span className="encyclopedia-card__pin" title="Pinned">📌</span>}
                      {entry.is_secret && isDM && <span className="encyclopedia-card__secret" title="Secret">🔒</span>}
                    </div>
                    <div className="encyclopedia-card__tags">
                      {entry.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="encyclopedia-tag">{tag}</span>
                      ))}
                      {entry.tags.length > 3 && <span className="encyclopedia-tag">+{entry.tags.length - 3}</span>}
                    </div>
                    {selectedEntry?.id === entry.id && (
                      <div className="encyclopedia-card__expanded">
                        {entry.summary && <p className="encyclopedia-card__summary">{entry.summary}</p>}
                        {entry.custom_lore && (
                          <div className="encyclopedia-card__lore">
                            <span className="encyclopedia-lore-label">📜 DM Lore</span>
                            <p>{entry.custom_lore}</p>
                          </div>
                        )}
                        {isDM && entry.dm_notes && (
                          <div className="encyclopedia-card__dm-notes">
                            <span className="encyclopedia-lore-label">🔑 DM Notes</span>
                            <p>{entry.dm_notes}</p>
                          </div>
                        )}
                        <div className="encyclopedia-card__importance">
                          Importance Score: <strong>{entry.importance}</strong>
                        </div>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Rumors Tab */}
      {tab === "rumors" && (
        <div className="encyclopedia-body">
          {loading ? (
            <div className="encyclopedia-loading"><div className="encyclopedia-spinner" /><span>Loading rumors...</span></div>
          ) : rumors.length === 0 ? (
            <div className="encyclopedia-empty"><span>🗣️</span><p>No rumors circulating yet.</p></div>
          ) : (
            <div className="rumors-list-full">
              {rumors.map((rumor) => (
                <div key={rumor.id} className={`rumor-card ${rumor.resolved ? "rumor-card--resolved" : ""}`}>
                  <div className="rumor-card__header">
                    <span className="rumor-card__source">{rumor.source_type}</span>
                    <span className="rumor-card__reliability" style={{ color: RELIABILITY_COLOR(rumor.reliability) }}>
                      {rumor.reliability}% reliable
                    </span>
                    {rumor.resolved && (
                      <span className={`rumor-card__verdict ${rumor.is_true ? "rumor-card__verdict--true" : "rumor-card__verdict--false"}`}>
                        {rumor.is_true ? "✓ TRUE" : "✗ FALSE"}
                      </span>
                    )}
                  </div>
                  <p className="rumor-card__content">{rumor.content}</p>
                  <div className="rumor-card__date">
                    {new Date(rumor.created_at).toLocaleDateString()}
                  </div>
                  {isDM && !rumor.resolved && (
                    <div className="rumor-card__actions">
                      <button className="btn-rumor-resolve btn-rumor-resolve--true" onClick={() => handleResolveRumor(rumor.id, true)}>
                        ✓ Confirm True
                      </button>
                      <button className="btn-rumor-resolve btn-rumor-resolve--false" onClick={() => handleResolveRumor(rumor.id, false)}>
                        ✗ Mark False
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline Tab */}
      {tab === "timeline" && (
        <div className="encyclopedia-body">
          {eras.length === 0 ? (
            <div className="encyclopedia-empty"><span>⏳</span><p>No historical eras recorded yet.</p></div>
          ) : (
            <div className="timeline-container">
              {eras.map((era, idx) => (
                <div key={era.id} className="timeline-era" style={{ "--era-color": era.color_theme ?? "#a78bfa" } as React.CSSProperties}>
                  <div className="timeline-era__marker">
                    <div className="timeline-era__dot" />
                    {idx < eras.length - 1 && <div className="timeline-era__line" />}
                  </div>
                  <div className="timeline-era__content">
                    <div className="timeline-era__header">
                      <h3 className="timeline-era__name">{era.name}</h3>
                      <span className="timeline-era__years">
                        {era.start_year} – {era.end_year ?? "Present"}
                      </span>
                    </div>
                    {era.description && <p className="timeline-era__desc">{era.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sessions Tab */}
      {tab === "sessions" && (
        <div className="encyclopedia-body">
          {loading ? (
            <div className="encyclopedia-loading"><div className="encyclopedia-spinner" /><span>Loading sessions...</span></div>
          ) : sessions.length === 0 ? (
            <div className="encyclopedia-empty"><span>🎲</span><p>No sessions recorded yet.</p></div>
          ) : (
            <div className="sessions-list">
              {sessions.map((session) => (
                <div key={session.id} className="session-card">
                  <div className="session-card__header">
                    <span className="session-card__number">Session #{session.session_number}</span>
                    {session.session_date && (
                      <span className="session-card__date">{new Date(session.session_date).toLocaleDateString()}</span>
                    )}
                    {session.summary_approved && <span className="session-card__approved">✓ Approved</span>}
                  </div>
                  {session.ai_summary ? (
                    <p className="session-card__summary">{session.ai_summary}</p>
                  ) : (
                    <p className="session-card__no-summary">No summary generated yet.</p>
                  )}
                  {isDM && (
                    <div className="session-card__actions">
                      {!session.ai_summary && (
                        <button className="btn-session" onClick={() => handleSummarizeSession(session.id)}>
                          🤖 Generate AI Summary
                        </button>
                      )}
                      {session.ai_summary && !session.summary_approved && (
                        <button className="btn-session btn-session--approve" onClick={() => handleApproveSession(session.id)}>
                          ✓ Approve Summary
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
