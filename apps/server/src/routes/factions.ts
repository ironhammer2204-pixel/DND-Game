import { Router, Response } from "express";
import { pool } from "../db/client";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { runFactionCycle, resolveAction } from "../game/factionEngine";
import { RoomManager } from "../websocket/roomManager";

const router = Router();

// Guard helpers
async function isCampaignMember(userId: string, campaignId: string): Promise<boolean> {
  const res = await pool.query(
    "SELECT 1 FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
    [campaignId, userId]
  );
  return res.rows.length > 0;
}

async function isCampaignDM(userId: string, campaignId: string): Promise<boolean> {
  const res = await pool.query(
    "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
    [campaignId, userId]
  );
  return res.rows[0]?.role === "dm";
}

// ─── GET /api/campaigns/:campaignId/factions ──────────────────────────────────
router.get("/:campaignId/factions", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignMember(userId, campaignId))) {
      res.status(403).json({ error: "Not a campaign member." });
      return;
    }

    const isDM = await isCampaignDM(userId, campaignId);
    let query = "SELECT * FROM public.factions WHERE campaign_id = $1";
    const params: any[] = [campaignId];

    if (!isDM) {
      query += " AND is_hidden = false";
    }
    query += " ORDER BY collapsed ASC, name ASC";

    const result = await pool.query(query, params);
    const factions = result.rows.map((row) => ({
      ...row,
      objectives: typeof row.objectives === "string" ? JSON.parse(row.objectives) : (row.objectives ?? []),
      victory_condition: typeof row.victory_condition === "string" ? JSON.parse(row.victory_condition) : (row.victory_condition ?? {}),
    }));

    res.json({ factions });
  } catch (err) {
    console.error("GET /factions error:", err);
    res.status(500).json({ error: "Failed to fetch factions." });
  }
});

// ─── GET /api/campaigns/:campaignId/factions/relations ─────────────────────────
router.get("/:campaignId/factions/relations", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignMember(userId, campaignId))) {
      res.status(403).json({ error: "Not a campaign member." });
      return;
    }

    const isDM = await isCampaignDM(userId, campaignId);
    let query = `
      SELECT r.* FROM public.faction_relations r
      JOIN public.factions fa ON fa.id = r.faction_a_id
      JOIN public.factions fb ON fb.id = r.faction_b_id
      WHERE r.campaign_id = $1
    `;
    const params: any[] = [campaignId];

    if (!isDM) {
      query += " AND fa.is_hidden = false AND fb.is_hidden = false";
    }

    const result = await pool.query(query, params);
    res.json({ relations: result.rows });
  } catch (err) {
    console.error("GET /relations error:", err);
    res.status(500).json({ error: "Failed to fetch relations." });
  }
});

// ─── GET /api/campaigns/:campaignId/factions/reputations ───────────────────────
router.get("/:campaignId/factions/reputations", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignMember(userId, campaignId))) {
      res.status(403).json({ error: "Not a campaign member." });
      return;
    }

    const isDM = await isCampaignDM(userId, campaignId);
    let query = `
      SELECT r.* FROM public.player_faction_reputation r
      JOIN public.factions f ON f.id = r.faction_id
      WHERE r.campaign_id = $1
    `;
    const params: any[] = [campaignId];

    if (!isDM) {
      query += " AND f.is_hidden = false";
    }

    const result = await pool.query(query, params);
    res.json({ reputations: result.rows });
  } catch (err) {
    console.error("GET /reputations error:", err);
    res.status(500).json({ error: "Failed to fetch reputations." });
  }
});

// ─── GET /api/campaigns/:campaignId/factions/actions ───────────────────────────
router.get("/:campaignId/factions/actions", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignMember(userId, campaignId))) {
      res.status(403).json({ error: "Not a campaign member." });
      return;
    }

    const isDM = await isCampaignDM(userId, campaignId);
    let query = `
      SELECT a.* FROM public.faction_actions a
      JOIN public.factions f ON f.id = a.faction_id
      WHERE a.campaign_id = $1
    `;
    const params: any[] = [campaignId];

    if (!isDM) {
      query += " AND f.is_hidden = false";
    }
    query += " ORDER BY a.created_at DESC";

    const result = await pool.query(query, params);
    res.json({ actions: result.rows });
  } catch (err) {
    console.error("GET /actions error:", err);
    res.status(500).json({ error: "Failed to fetch actions." });
  }
});

// ─── POST /api/campaigns/:campaignId/factions ─────────────────────────────────
router.post("/:campaignId/factions", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;
  const {
    name,
    type,
    personality,
    description,
    is_hidden,
    military,
    wealth,
    influence,
    stability,
    pressure_cap,
    objectives,
    victory_condition,
  } = req.body;

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Forbidden: DM only action." });
      return;
    }

    const insertRes = await pool.query(
      `INSERT INTO public.factions
       (campaign_id, name, type, personality, description, is_hidden, military, wealth, influence, stability, pressure, pressure_cap, objectives, victory_condition, is_victorious, collapsed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12::jsonb, $13::jsonb, false, false)
       RETURNING *`,
      [
        campaignId,
        name,
        type || "neutral",
        personality || "defensive",
        description || null,
        is_hidden || false,
        military ?? 0,
        wealth ?? 0,
        influence ?? 0,
        stability ?? 100,
        pressure_cap ?? 2000,
        JSON.stringify(objectives || []),
        JSON.stringify(victory_condition || {}),
      ]
    );

    const faction = {
      ...insertRes.rows[0],
      objectives: objectives || [],
      victory_condition: victory_condition || {},
    };

    RoomManager.broadcastToRoom(campaignId, "FACTION_UPDATE", { faction });

    res.status(201).json({ faction });
  } catch (err) {
    console.error("POST /factions error:", err);
    res.status(500).json({ error: "Failed to create faction." });
  }
});

// ─── POST /api/campaigns/:campaignId/factions/engine/pause ─────────────────────
router.post("/:campaignId/factions/engine/pause", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;
  const { pause } = req.body;

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Forbidden: DM only action." });
      return;
    }

    await pool.query(
      `UPDATE public.campaigns
       SET world_state = jsonb_set(coalesce(world_state, '{}'::jsonb), '{faction_engine_paused}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(!!pause), campaignId]
    );

    res.json({ success: true, paused: !!pause });
  } catch (err) {
    console.error("POST /engine/pause error:", err);
    res.status(500).json({ error: "Failed to pause/resume engine." });
  }
});

// ─── POST /api/campaigns/:campaignId/factions/engine/cycle ─────────────────────
router.post("/:campaignId/factions/engine/cycle", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Forbidden: DM only action." });
      return;
    }

    // Force a cycle run inside client connection
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await runFactionCycle(client, campaignId, true);
      await client.query("COMMIT");
    } catch (cycleErr) {
      await client.query("ROLLBACK");
      throw cycleErr;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (err) {
    console.error("POST /engine/cycle error:", err);
    res.status(500).json({ error: "Failed to cycle faction engine." });
  }
});

// ─── POST /api/campaigns/:campaignId/actions/:actionId/veto ────────────────────
router.post("/:campaignId/actions/:actionId/veto", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, actionId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Forbidden: DM only action." });
      return;
    }

    await resolveAction(pool, campaignId, actionId, true);
    res.json({ success: true });
  } catch (err) {
    console.error("POST /actions/:actionId/veto error:", err);
    res.status(500).json({ error: "Failed to veto action." });
  }
});

// ─── POST /api/campaigns/:campaignId/factions/:factionId/force ─────────────────
router.post("/:campaignId/factions/:factionId/force", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, factionId } = req.params;
  const userId = req.user!.sub;
  const { action_type, target_type, target_id } = req.body;

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Forbidden: DM only action." });
      return;
    }

    // Force inserts a pending action and immediately resolves it
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Insert action
      const actionRes = await client.query(
        `INSERT INTO public.faction_actions (campaign_id, faction_id, action_type, target_type, target_id, pressure_cost, status, cooldown_until, triggered_by)
         VALUES ($1, $2, $3, $4, $5, 0, 'pending', now(), 'dm')
         RETURNING id`,
        [campaignId, factionId, action_type, target_type, target_id]
      );

      const actionId = actionRes.rows[0].id;

      // Resolve action
      await resolveAction(client, campaignId, actionId, false);

      await client.query("COMMIT");
      res.json({ success: true, actionId });
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /factions/:factionId/force error:", err);
    res.status(500).json({ error: "Failed to force action." });
  }
});

// ─── PATCH /api/campaigns/:campaignId/factions/relations ──────────────────────
router.patch("/:campaignId/factions/relations", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;
  const { faction_a_id, faction_b_id, score, treaty_type, expires_in_days } = req.body;

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Forbidden: DM only action." });
      return;
    }

    const expiry = expires_in_days ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000) : null;

    const upsertRes = await pool.query(
      `INSERT INTO public.faction_relations (campaign_id, faction_a_id, faction_b_id, score, treaty_type, treaty_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (campaign_id, faction_a_id, faction_b_id)
       DO UPDATE SET score = EXCLUDED.score, treaty_type = EXCLUDED.treaty_type, treaty_expires_at = EXCLUDED.treaty_expires_at
       RETURNING *`,
      [campaignId, faction_a_id, faction_b_id, score, treaty_type || "none", expiry]
    );

    res.json({ relation: upsertRes.rows[0] });
  } catch (err) {
    console.error("PATCH /relations error:", err);
    res.status(500).json({ error: "Failed to update relations." });
  }
});

export default router;
