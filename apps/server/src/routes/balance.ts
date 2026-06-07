import { Router } from "express";
import { pool } from "../db/client";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { runBalancingCycle } from "../game/balancingEngine";

const router = Router({ mergeParams: true });

async function isDm(campaignId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
    [campaignId, userId]
  );
  return res.rows[0]?.role === "dm";
}

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/balance/snapshots
// DM: last N balance snapshots
// ---------------------------------------------------------------------------
router.get("/:id/balance/snapshots", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    if (!(await isDm(campaignId, req.user!.userId))) {
      return res.status(403).json({ error: "DM role required" });
    }
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const snapshots = await pool.query(
      `SELECT * FROM public.balance_snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [campaignId, limit]
    );
    return res.json({ snapshots: snapshots.rows });
  } catch (err) {
    console.error("[balance] GET /balance/snapshots:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/balance/alerts
// DM: unresolved balance alerts
// ---------------------------------------------------------------------------
router.get("/:id/balance/alerts", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    if (!(await isDm(campaignId, req.user!.userId))) {
      return res.status(403).json({ error: "DM role required" });
    }
    const alerts = await pool.query(
      `SELECT * FROM public.balance_alerts WHERE campaign_id = $1 AND resolved = false ORDER BY created_at DESC`,
      [campaignId]
    );
    return res.json({ alerts: alerts.rows });
  } catch (err) {
    console.error("[balance] GET /balance/alerts:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/campaigns/:id/balance/alerts/:alertId/resolve
// DM: dismiss a balance alert
// ---------------------------------------------------------------------------
router.patch("/:id/balance/alerts/:alertId/resolve", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, alertId } = req.params;
    if (!(await isDm(campaignId, req.user!.userId))) {
      return res.status(403).json({ error: "DM role required" });
    }
    await pool.query(
      "UPDATE public.balance_alerts SET resolved = true, resolved_at = now() WHERE id = $1 AND campaign_id = $2",
      [alertId, campaignId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("[balance] PATCH /balance/alerts/:alertId/resolve:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/balance/cycle
// DM: manually trigger a balancing cycle
// ---------------------------------------------------------------------------
router.post("/:id/balance/cycle", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    if (!(await isDm(campaignId, req.user!.userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    // Fire-and-forget; result is broadcast via WebSocket
    runBalancingCycle(pool, campaignId).catch((err) =>
      console.error("[balance] Manual cycle error:", err)
    );

    return res.json({ message: "Balancing cycle started. Results will be broadcast via WebSocket." });
  } catch (err) {
    console.error("[balance] POST /balance/cycle:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/balance/overrides
// DM: get current drop rate / combat scaling overrides
// ---------------------------------------------------------------------------
router.get("/:id/balance/overrides", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    if (!(await isDm(campaignId, req.user!.userId))) {
      return res.status(403).json({ error: "DM role required" });
    }
    const overrides = await pool.query(
      "SELECT * FROM public.balance_overrides WHERE campaign_id = $1",
      [campaignId]
    );
    return res.json({ overrides: overrides.rows });
  } catch (err) {
    console.error("[balance] GET /balance/overrides:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/campaigns/:id/balance/overrides
// DM: set a manual override (drop_rate_modifier, xp_modifier, etc.)
// ---------------------------------------------------------------------------
router.put("/:id/balance/overrides", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    if (!(await isDm(campaignId, req.user!.userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    const { metric_type, value, reason, expires_at } = req.body;
    if (!metric_type || value === undefined) {
      return res.status(400).json({ error: "metric_type and value required" });
    }

    const result = await pool.query(
      `INSERT INTO public.balance_overrides (campaign_id, metric_type, value, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (campaign_id, metric_type)
       DO UPDATE SET value = EXCLUDED.value, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, updated_at = now()
       RETURNING *`,
      [campaignId, metric_type, value, reason ?? null, expires_at ?? null]
    );

    return res.json({ override: result.rows[0] });
  } catch (err) {
    console.error("[balance] PUT /balance/overrides:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
