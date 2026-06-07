import { useState, useEffect, useCallback } from "react";
import { API_URL } from "../config";
import "./BalanceDashboard.css";

interface BalanceSnapshot {
  id: string;
  created_at: string;
  economy_metrics: Record<string, number>;
  combat_metrics: Record<string, number>;
  loot_metrics: Record<string, number>;
  faction_metrics: Record<string, number>;
  progression_metrics: Record<string, number>;
  adjustments_applied: Record<string, unknown>[];
  cycle_number: number;
}

interface BalanceAlert {
  id: string;
  created_at: string;
  metric_type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  resolved: boolean;
}

interface BalanceOverride {
  id: string;
  metric_type: string;
  value: number;
  reason?: string;
  expires_at?: string;
}

interface BalanceDashboardProps {
  campaignId: string;
  token: string;
}

const METRIC_ICON: Record<string, string> = {
  economy: "💰",
  combat: "⚔️",
  loot: "🎁",
  faction: "🏰",
  progression: "⬆️",
};

const SEVERITY_COLOR: Record<string, string> = {
  info: "#60a5fa",
  warning: "#facc15",
  critical: "#f87171",
};

const SEVERITY_BG: Record<string, string> = {
  info: "rgba(96, 165, 250, 0.1)",
  warning: "rgba(250, 204, 21, 0.1)",
  critical: "rgba(248, 113, 113, 0.1)",
};

function MetricBar({ label, value, max = 100, color = "#a78bfa" }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="metric-bar">
      <div className="metric-bar__header">
        <span className="metric-bar__label">{label}</span>
        <span className="metric-bar__value">{typeof value === "number" ? value.toFixed(2) : value}</span>
      </div>
      <div className="metric-bar__track">
        <div
          className="metric-bar__fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function BalanceDashboard({ campaignId, token }: BalanceDashboardProps) {
  const [snapshots, setSnapshots] = useState<BalanceSnapshot[]>([]);
  const [alerts, setAlerts] = useState<BalanceAlert[]>([]);
  const [overrides, setOverrides] = useState<BalanceOverride[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<BalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [cycling, setCycling] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<"overview" | "alerts" | "overrides">("overview");

  // Override form state
  const [newOverride, setNewOverride] = useState({ metric_type: "drop_rate_modifier", value: 1.0, reason: "" });

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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [snapData, alertData, overrideData] = await Promise.all([
        apiFetch(`/api/campaigns/${campaignId}/balance/snapshots?limit=10`),
        apiFetch(`/api/campaigns/${campaignId}/balance/alerts`),
        apiFetch(`/api/campaigns/${campaignId}/balance/overrides`),
      ]);
      setSnapshots(snapData.snapshots ?? []);
      setAlerts(alertData.alerts ?? []);
      setOverrides(overrideData.overrides ?? []);
      if (snapData.snapshots?.length > 0) setSelectedSnapshot(snapData.snapshots[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load balance data");
    } finally {
      setLoading(false);
    }
  }, [campaignId, apiFetch]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleRunCycle = async () => {
    setCycling(true);
    setError("");
    try {
      await apiFetch(`/api/campaigns/${campaignId}/balance/cycle`, { method: "POST" });
      setTimeout(fetchAll, 3000); // Refresh after a short delay
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger balance cycle");
    } finally {
      setTimeout(() => setCycling(false), 3000);
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      await apiFetch(`/api/campaigns/${campaignId}/balance/alerts/${alertId}/resolve`, { method: "PATCH" });
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss alert");
    }
  };

  const handleSetOverride = async () => {
    try {
      await apiFetch(`/api/campaigns/${campaignId}/balance/overrides`, {
        method: "PUT",
        body: JSON.stringify(newOverride),
      });
      fetchAll();
      setNewOverride({ metric_type: "drop_rate_modifier", value: 1.0, reason: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set override");
    }
  };

  const snap = selectedSnapshot;
  const unresolvedAlerts = alerts.filter((a) => !a.resolved);

  const renderMetricsSection = (label: string, icon: string, data?: Record<string, number>, colorBase = "#a78bfa") => {
    if (!data || Object.keys(data).length === 0) return null;
    return (
      <div className="balance-metrics-section">
        <div className="balance-metrics-section__header">
          <span>{icon}</span>
          <h4>{label}</h4>
        </div>
        {Object.entries(data).map(([key, val]) => (
          <MetricBar
            key={key}
            label={key.replace(/_/g, " ")}
            value={val}
            max={key.includes("score") || key.includes("percent") ? 100 : key.includes("gini") ? 1 : 1000}
            color={colorBase}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="balance-dashboard">
      {/* Header */}
      <div className="balance-header">
        <div className="balance-header__top">
          <div className="balance-header__title">
            <span>⚖️</span>
            <h2>Balance Dashboard</h2>
          </div>
          <button
            className={`btn-run-cycle ${cycling ? "btn-run-cycle--running" : ""}`}
            onClick={handleRunCycle}
            disabled={cycling}
          >
            {cycling ? "⏳ Running..." : "▶ Run Cycle"}
          </button>
        </div>
        <div className="balance-header__sections">
          {(["overview", "alerts", "overrides"] as const).map((s) => (
            <button
              key={s}
              className={`balance-section-btn ${activeSection === s ? "balance-section-btn--active" : ""}`}
              onClick={() => setActiveSection(s)}
            >
              {s === "overview" && "📊 Overview"}
              {s === "alerts" && (
                <>⚠️ Alerts {unresolvedAlerts.length > 0 && <span className="alert-badge">{unresolvedAlerts.length}</span>}</>
              )}
              {s === "overrides" && "🔧 Overrides"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="balance-error" role="alert">{error}</div>}

      <div className="balance-body">
        {/* Overview */}
        {activeSection === "overview" && (
          <>
            {/* Snapshot selector */}
            {snapshots.length > 0 && (
              <div className="snapshot-selector">
                <label className="snapshot-selector__label">Cycle History:</label>
                <div className="snapshot-selector__list">
                  {snapshots.map((s) => (
                    <button
                      key={s.id}
                      className={`snapshot-pill ${selectedSnapshot?.id === s.id ? "snapshot-pill--active" : ""}`}
                      onClick={() => setSelectedSnapshot(s)}
                    >
                      #{s.cycle_number ?? "?"} — {new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <div className="balance-loading">
                <div className="balance-spinner" />
                <span>Loading balance data...</span>
              </div>
            ) : !snap ? (
              <div className="balance-empty">
                <span>⚖️</span>
                <p>No balance cycles run yet.<br/>Click "Run Cycle" to analyze the campaign.</p>
              </div>
            ) : (
              <div className="balance-metrics-grid">
                {renderMetricsSection("Economy", "💰", snap.economy_metrics, "#facc15")}
                {renderMetricsSection("Combat", "⚔️", snap.combat_metrics, "#f87171")}
                {renderMetricsSection("Loot", "🎁", snap.loot_metrics, "#34d399")}
                {renderMetricsSection("Factions", "🏰", snap.faction_metrics, "#60a5fa")}
                {renderMetricsSection("Progression", "⬆️", snap.progression_metrics, "#a78bfa")}

                {snap.adjustments_applied?.length > 0 && (
                  <div className="balance-adjustments">
                    <h4 className="balance-adjustments__title">🔄 Adjustments Applied</h4>
                    {snap.adjustments_applied.map((adj, idx) => (
                      <div key={idx} className="adjustment-chip">
                        {JSON.stringify(adj)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Alerts */}
        {activeSection === "alerts" && (
          <div className="alerts-list">
            {unresolvedAlerts.length === 0 ? (
              <div className="balance-empty">
                <span>✅</span>
                <p>No active balance alerts.<br/>The campaign is balanced.</p>
              </div>
            ) : (
              unresolvedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="alert-card"
                  style={{
                    borderColor: SEVERITY_COLOR[alert.severity] + "44",
                    background: SEVERITY_BG[alert.severity],
                  }}
                >
                  <div className="alert-card__header">
                    <span className="alert-card__type" style={{ color: SEVERITY_COLOR[alert.severity] }}>
                      {METRIC_ICON[alert.metric_type] ?? "⚖️"} {alert.metric_type.replace(/_/g, " ")}
                    </span>
                    <span className="alert-card__severity" style={{ color: SEVERITY_COLOR[alert.severity] }}>
                      {alert.severity.toUpperCase()}
                    </span>
                    <span className="alert-card__date">
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="alert-card__message">{alert.message}</p>
                  <button className="btn-dismiss-alert" onClick={() => handleDismissAlert(alert.id)}>
                    ✓ Dismiss
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Overrides */}
        {activeSection === "overrides" && (
          <div className="overrides-section">
            {/* Add override form */}
            <div className="override-form">
              <h4 className="override-form__title">🔧 Set Manual Override</h4>
              <div className="override-form__row">
                <select
                  className="override-input"
                  value={newOverride.metric_type}
                  onChange={(e) => setNewOverride((prev) => ({ ...prev, metric_type: e.target.value }))}
                >
                  <option value="drop_rate_modifier">Drop Rate Modifier</option>
                  <option value="xp_modifier">XP Modifier</option>
                  <option value="gold_modifier">Gold Modifier</option>
                  <option value="combat_difficulty">Combat Difficulty</option>
                  <option value="faction_rubber_band">Faction Rubber-Band</option>
                  <option value="progression_soft_cap">Progression Soft Cap</option>
                </select>
                <input
                  className="override-input"
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="5"
                  value={newOverride.value}
                  onChange={(e) => setNewOverride((prev) => ({ ...prev, value: parseFloat(e.target.value) }))}
                />
              </div>
              <input
                className="override-input override-input--full"
                type="text"
                placeholder="Reason (optional)"
                value={newOverride.reason}
                onChange={(e) => setNewOverride((prev) => ({ ...prev, reason: e.target.value }))}
              />
              <button className="btn-set-override" onClick={handleSetOverride}>
                ⚡ Apply Override
              </button>
            </div>

            {/* Existing overrides */}
            {overrides.length > 0 && (
              <div className="existing-overrides">
                <h4 className="existing-overrides__title">Active Overrides</h4>
                {overrides.map((ov) => (
                  <div key={ov.id} className="override-card">
                    <div className="override-card__header">
                      <span className="override-card__type">{ov.metric_type.replace(/_/g, " ")}</span>
                      <span className="override-card__value">× {ov.value}</span>
                    </div>
                    {ov.reason && <p className="override-card__reason">{ov.reason}</p>}
                    {ov.expires_at && (
                      <p className="override-card__expiry">Expires: {new Date(ov.expires_at).toLocaleString()}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
