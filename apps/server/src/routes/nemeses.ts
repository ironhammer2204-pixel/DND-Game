import { Router, Response } from "express";
import { pool } from "../db/client";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import {
  getNemesisById,
  promoteEnemyToNemesis,
  recordNemesisHistory,
  triggerNemesisAmbush,
  generateNemesisEpithet,
  handleNemesisQuestIntegration,
} from "../game/nemesisEngine";
import { TIER_ORDER } from "../game/nemesisConfig";
import type { NemesisTier, NemesisStatus } from "@dnd/shared";
import { RoomManager } from "../websocket/roomManager";

const router = Router();

// ─── Guard helpers ───────────────────────────────────────────────────────────

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

// ─── GET /api/campaigns/:campaignId/nemeses ───────────────────────────────────
// Returns full nemesis roster. Accessible to all campaign members.
router.get("/:campaignId/nemeses", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignMember(userId, campaignId))) {
      res.status(403).json({ error: "Not a campaign member." });
      return;
    }

    const result = await pool.query(
      `SELECT n.*,
              f.name AS faction_name,
              l.name AS location_name,
              c.name AS target_character_name
       FROM public.nemeses n
       LEFT JOIN public.factions f ON f.id = n.faction_id
       LEFT JOIN public.locations l ON l.id = n.location_id
       LEFT JOIN public.characters c ON c.id = n.target_character_id
       WHERE n.campaign_id = $1
       ORDER BY
         CASE n.status
           WHEN 'active' THEN 0 WHEN 'ambushing' THEN 1 WHEN 'missing' THEN 2
           WHEN 'retired' THEN 3 WHEN 'dead' THEN 4 ELSE 5 END,
         n.tier DESC, n.grudge_score DESC`,
      [campaignId]
    );

    const nemeses = result.rows.map((row) => ({
      ...row,
      traits: typeof row.traits === "string" ? JSON.parse(row.traits) : row.traits,
      tactics: typeof row.tactics === "string" ? JSON.parse(row.tactics) : row.tactics,
      stats: typeof row.stats === "string" ? JSON.parse(row.stats) : row.stats,
      scars: typeof row.scars === "string" ? JSON.parse(row.scars) : row.scars,
      appearance: typeof row.appearance === "string" ? JSON.parse(row.appearance) : row.appearance,
      minion_ids: row.minion_ids ?? [],
    }));

    res.json({ nemeses });
  } catch (err) {
    console.error("GET /nemeses error:", err);
    res.status(500).json({ error: "Failed to fetch nemeses." });
  }
});

// ─── GET /api/campaigns/:campaignId/nemeses/:nemesisId ────────────────────────
// Returns a single nemesis with full history and linked quests.
router.get("/:campaignId/nemeses/:nemesisId", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, nemesisId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignMember(userId, campaignId))) {
      res.status(403).json({ error: "Not a campaign member." });
      return;
    }

    const nemesis = await getNemesisById(pool, campaignId, nemesisId);
    if (!nemesis) {
      res.status(404).json({ error: "Nemesis not found." });
      return;
    }

    const historyRes = await pool.query(
      `SELECT nh.*, c.name AS actor_character_name
       FROM public.nemesis_history nh
       LEFT JOIN public.characters c ON c.id = nh.actor_character_id
       WHERE nh.nemesis_id = $1
       ORDER BY nh.occurred_at DESC
       LIMIT 50`,
      [nemesisId]
    );

    const history = historyRes.rows.map((row) => ({
      ...row,
      mechanical_data: typeof row.mechanical_data === "string" ? JSON.parse(row.mechanical_data) : row.mechanical_data,
    }));

    res.json({ nemesis, history });
  } catch (err) {
    console.error("GET /nemeses/:id error:", err);
    res.status(500).json({ error: "Failed to fetch nemesis." });
  }
});

// ─── POST /api/campaigns/:campaignId/nemeses/promote ─────────────────────────
// DM manually promotes an enemy NPC/monster to nemesis.
router.post("/:campaignId/nemeses/promote", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId } = req.params;
  const userId = req.user!.sub;
  const { name, source_monster_id, tier = "soldier", target_character_id, reason = "dm_promotion" } = req.body as {
    name?: string;
    source_monster_id?: string;
    tier?: NemesisTier;
    target_character_id?: string;
    reason?: string;
  };

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Only the DM can promote nemeses." });
      return;
    }

    if (!TIER_ORDER.includes(tier)) {
      res.status(400).json({ error: "Invalid tier." });
      return;
    }

    // Build a minimal fake CombatParticipant for the promotion utility
    const fakeEnemy = {
      id: `manual-${Date.now()}`,
      name: name || "Unknown Foe",
      type: "enemy" as const,
      hp_current: 10,
      hp_max: 10,
      initiative: 10,
      conditions: [],
      ac: 12,
      attack_bonus: 2,
      damage_dice: "1d6",
      damage_modifier: 0,
      xp_value: 100,
      source_monster_id,
      damage_dealt: 0,
      damage_taken: 0,
      downed_character_ids: [],
    };

    const { nemesis, history } = await promoteEnemyToNemesis(pool, campaignId, fakeEnemy, {
      reason,
      targetCharacterId: target_character_id,
      tier,
      grudgeScore: 15,
    });

    RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", {
      nemesis,
      history_entry: history,
      reason: "promoted",
    });

    res.status(201).json({ nemesis, history });
  } catch (err) {
    console.error("POST /nemeses/promote error:", err);
    res.status(500).json({ error: "Failed to promote nemesis." });
  }
});

// ─── PATCH /api/campaigns/:campaignId/nemeses/:nemesisId/status ───────────────
// DM changes nemesis status (retire, reactivate, mark dead, etc.)
router.patch("/:campaignId/nemeses/:nemesisId/status", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, nemesisId } = req.params;
  const userId = req.user!.sub;
  const { status, note } = req.body as { status: NemesisStatus; note?: string };

  const VALID_STATUSES: NemesisStatus[] = ["active", "dead", "retired", "missing", "ambushing"];

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Only the DM can change nemesis status." });
      return;
    }

    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status." });
      return;
    }

    const result = await pool.query(
      "UPDATE public.nemeses SET status = $1, last_seen_at = now() WHERE id = $2 AND campaign_id = $3 RETURNING *",
      [status, nemesisId, campaignId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Nemesis not found." });
      return;
    }

    const nemesis = await getNemesisById(pool, campaignId, nemesisId);
    const history = await recordNemesisHistory(pool, campaignId, nemesisId, {
      eventType: `nemesis_${status === "dead" ? "killed" : status}`,
      summary: note || `${nemesis?.name} status changed to ${status} by DM.`,
      mechanicalData: { status, changed_by: userId },
    });

    RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", {
      nemesis: nemesis!,
      history_entry: history,
      reason: status,
    });

    if (status === "dead" && nemesis) {
      await handleNemesisQuestIntegration(pool, campaignId, nemesis, "killed");
    }

    res.json({ nemesis, history });
  } catch (err) {
    console.error("PATCH /nemeses/:id/status error:", err);
    res.status(500).json({ error: "Failed to update nemesis status." });
  }
});

// ─── POST /api/campaigns/:campaignId/nemeses/:nemesisId/history ───────────────
// DM adds a manual story note to nemesis history.
router.post("/:campaignId/nemeses/:nemesisId/history", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, nemesisId } = req.params;
  const userId = req.user!.sub;
  const { summary, event_type = "dm_note", mechanical_data } = req.body as {
    summary: string;
    event_type?: string;
    mechanical_data?: Record<string, unknown>;
  };

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Only the DM can add history notes." });
      return;
    }

    if (!summary?.trim()) {
      res.status(400).json({ error: "Summary is required." });
      return;
    }

    const history = await recordNemesisHistory(pool, campaignId, nemesisId, {
      eventType: event_type,
      summary,
      actorCharacterId: null,
      mechanicalData: mechanical_data || { added_by: userId },
    });

    res.status(201).json({ history });
  } catch (err) {
    console.error("POST /nemeses/:id/history error:", err);
    res.status(500).json({ error: "Failed to add history entry." });
  }
});

// ─── PATCH /api/campaigns/:campaignId/nemeses/:nemesisId/tier ─────────────────
// DM manually assigns a tier (up or down).
router.patch("/:campaignId/nemeses/:nemesisId/tier", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, nemesisId } = req.params;
  const userId = req.user!.sub;
  const { tier } = req.body as { tier: NemesisTier };

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Only the DM can change nemesis tier." });
      return;
    }

    if (!TIER_ORDER.includes(tier)) {
      res.status(400).json({ error: "Invalid tier. Must be one of: soldier, lieutenant, warlord, archnemesis." });
      return;
    }

    const current = await getNemesisById(pool, campaignId, nemesisId);
    if (!current) {
      res.status(404).json({ error: "Nemesis not found." });
      return;
    }

    // Generate new epithet for the new tier
    const newEpithet = generateNemesisEpithet(tier, `${nemesisId}-${tier}`);

    const result = await pool.query(
      "UPDATE public.nemeses SET tier = $1, epithet = $2 WHERE id = $3 AND campaign_id = $4 RETURNING *",
      [tier, newEpithet, nemesisId, campaignId]
    );

    const nemesis = await getNemesisById(pool, campaignId, nemesisId);
    const history = await recordNemesisHistory(pool, campaignId, nemesisId, {
      eventType: "nemesis_tiered_up",
      summary: `${current.name} was manually set to ${tier} tier by the DM.`,
      mechanicalData: { from_tier: current.tier, to_tier: tier, new_epithet: result.rows[0]?.epithet },
    });

    RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", {
      nemesis: nemesis!,
      history_entry: history,
      reason: "tier_change",
    });

    if (nemesis) {
      await handleNemesisQuestIntegration(pool, campaignId, nemesis, "tiered_up");
    }

    res.json({ nemesis, history });
  } catch (err) {
    console.error("PATCH /nemeses/:id/tier error:", err);
    res.status(500).json({ error: "Failed to change nemesis tier." });
  }
});

// ─── POST /api/campaigns/:campaignId/nemeses/:nemesisId/successor ─────────────
// DM assigns a specific successor nemesis.
router.post("/:campaignId/nemeses/:nemesisId/successor", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, nemesisId } = req.params;
  const userId = req.user!.sub;
  const { successor_nemesis_id } = req.body as { successor_nemesis_id: string };

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Only the DM can assign successors." });
      return;
    }

    const nemesis = await getNemesisById(pool, campaignId, nemesisId);
    if (!nemesis) {
      res.status(404).json({ error: "Nemesis not found." });
      return;
    }

    const successor = await getNemesisById(pool, campaignId, successor_nemesis_id);
    if (!successor) {
      res.status(404).json({ error: "Successor nemesis not found." });
      return;
    }

    await pool.query(
      "UPDATE public.nemeses SET successor_nemesis_id = $1 WHERE id = $2 AND campaign_id = $3",
      [successor_nemesis_id, nemesisId, campaignId]
    );

    // Transfer grudge to successor
    await pool.query(
      "UPDATE public.nemeses SET grudge_score = grudge_score + $1, target_character_id = $2 WHERE id = $3",
      [nemesis.grudge_score, nemesis.target_character_id, successor_nemesis_id]
    );

    const history = await recordNemesisHistory(pool, campaignId, nemesisId, {
      eventType: "nemesis_successor_named",
      summary: `${successor.name} ${successor.epithet || ""} inherits ${nemesis.name}'s grudge.`,
      mechanicalData: { successor_id: successor_nemesis_id, grudge_transferred: nemesis.grudge_score },
    });

    const updatedNemesis = await getNemesisById(pool, campaignId, nemesisId);
    RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", {
      nemesis: updatedNemesis!,
      history_entry: history,
      reason: "successor_named",
    });

    if (successor) {
      await handleNemesisQuestIntegration(pool, campaignId, successor, "successor", nemesisId);
    }

    res.json({ nemesis: updatedNemesis, successor, history });
  } catch (err) {
    console.error("POST /nemeses/:id/successor error:", err);
    res.status(500).json({ error: "Failed to assign successor." });
  }
});

// ─── POST /api/campaigns/:campaignId/nemeses/:nemesisId/ambush ────────────────
// DM manually triggers an ambush for a nemesis.
router.post("/:campaignId/nemeses/:nemesisId/ambush", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, nemesisId } = req.params;
  const userId = req.user!.sub;

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Only the DM can trigger ambushes." });
      return;
    }

    const nemesis = await triggerNemesisAmbush(pool, campaignId, nemesisId);
    if (!nemesis) {
      res.status(404).json({ error: "Nemesis not found or cannot ambush." });
      return;
    }

    res.json({ nemesis });
  } catch (err) {
    console.error("POST /nemeses/:id/ambush error:", err);
    res.status(500).json({ error: "Failed to trigger ambush." });
  }
});


// ─── PATCH /api/campaigns/:campaignId/nemeses/:nemesisId/faction ──────────────
// DM assigns a nemesis to a faction.
router.patch("/:campaignId/nemeses/:nemesisId/faction", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaignId, nemesisId } = req.params;
  const userId = req.user!.sub;
  const { faction_id } = req.body as { faction_id: string | null };

  try {
    if (!(await isCampaignDM(userId, campaignId))) {
      res.status(403).json({ error: "Only the DM can assign factions." });
      return;
    }

    await pool.query(
      "UPDATE public.nemeses SET faction_id = $1 WHERE id = $2 AND campaign_id = $3",
      [faction_id || null, nemesisId, campaignId]
    );

    const nemesis = await getNemesisById(pool, campaignId, nemesisId);
    if (!nemesis) {
      res.status(404).json({ error: "Nemesis not found." });
      return;
    }

    const history = await recordNemesisHistory(pool, campaignId, nemesisId, {
      eventType: faction_id ? "nemesis_faction_joined" : "nemesis_faction_left",
      summary: faction_id
        ? `${nemesis.name} was assigned to a faction.`
        : `${nemesis.name} was removed from their faction.`,
      mechanicalData: { faction_id },
    });

    RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", {
      nemesis,
      history_entry: history,
      reason: "faction_change",
    });

    res.json({ nemesis, history });
  } catch (err) {
    console.error("PATCH /nemeses/:id/faction error:", err);
    res.status(500).json({ error: "Failed to assign faction." });
  }
});

export default router;
