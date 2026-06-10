/**
 * routes/solo.ts
 *
 * REST API endpoints for single-player mode.
 */

import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { pool } from "../db/client";
import {
  initializeSoloCampaign,
  processSoloAction,
  getSoloGameStatus,
  endSoloGame,
} from "../game/soloEngine";
import { runWorldHeartbeat } from "../game/worldEngine";
import { dmService } from "../ai/dmService";

const router = Router();

router.post("/start", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.sub;
    const metadataUsername = req.user?.user_metadata?.username;
    const username =
      typeof metadataUsername === "string" && metadataUsername.trim()
        ? metadataUsername.trim()
        : "Adventurer";

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { characterName, characterClass = "Fighter", characterRace = "Human" } = req.body;

    if (!characterName) {
      return res.status(400).json({ error: "Character name is required" });
    }

    const validClasses = ["Fighter", "Wizard", "Rogue", "Cleric", "Barbarian", "Ranger"];
    const validRaces = ["Human", "Elf", "Dwarf", "Halfling", "Half-Orc", "Tiefling"];

    if (!validClasses.includes(characterClass)) {
      return res.status(400).json({ error: `Invalid class. Choose from: ${validClasses.join(", ")}` });
    }

    if (!validRaces.includes(characterRace)) {
      return res.status(400).json({ error: `Invalid race. Choose from: ${validRaces.join(", ")}` });
    }

    const { campaignId, characterId } = await initializeSoloCampaign(
      userId,
      username,
      characterName,
      characterClass,
      characterRace,
    );

    res.status(201).json({
      message: "Solo adventure started!",
      campaign_id: campaignId,
      character_id: characterId,
      mode: "solo",
      ai_dm: dmService.isEnabled(),
      narration_source: dmService.isEnabled() ? "ai" : "offline",
    });
  } catch (error) {
    console.error("[SoloRoutes] Start failed:", error);
    res.status(500).json({ error: "Failed to start solo adventure" });
  }
});

router.post("/action", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { campaign_id, action } = req.body;

    if (!campaign_id || !action) {
      return res.status(400).json({ error: "campaign_id and action are required" });
    }

    const memberCheck = await pool.query(
      "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
      [campaign_id, userId],
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: "Not a member of this campaign" });
    }

    const result = await processSoloAction(campaign_id, userId, action);

    res.json({
      success: true,
      result,
      turn: result.turn || 1,
      narration: result.narration,
    });
  } catch (error) {
    console.error("[SoloRoutes] Action failed:", error);
    res.status(500).json({ error: "Failed to process action" });
  }
});

router.get("/status/:campaignId", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.sub;
    const { campaignId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const campaignRes = await pool.query(
      `SELECT c.*,
        (SELECT json_agg(l.*) FROM public.locations l WHERE l.campaign_id = c.id) AS locations,
        (SELECT json_agg(q.*) FROM public.quests q WHERE q.campaign_id = c.id AND q.status = 'active') AS active_quests
       FROM public.campaigns c
       WHERE c.id = $1`,
      [campaignId],
    );

    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const campaign = campaignRes.rows[0];

    const charRes = await pool.query(
      `SELECT * FROM public.characters
       WHERE campaign_id = $1 AND user_id = $2 AND is_alive = true
       LIMIT 1`,
      [campaignId, userId],
    );

    const eventsRes = await pool.query(
      `SELECT * FROM public.event_log
       WHERE campaign_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [campaignId],
    );

    const encyclopediaRes = charRes.rows[0]
      ? await pool.query(
          `SELECT e.*, ck.knowledge_level
           FROM public.encyclopedia_entries e
           JOIN public.character_knowledge ck ON ck.entry_id = e.id
           WHERE ck.character_id = $1
           ORDER BY e.importance DESC
           LIMIT 20`,
          [charRes.rows[0].id],
        )
      : { rows: [] };

    const gameState = getSoloGameStatus(campaignId);

    res.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        world_state: campaign.world_state,
        locations: campaign.locations || [],
        active_quests: campaign.active_quests || [],
      },
      character: charRes.rows[0] || null,
      events: eventsRes.rows.reverse(),
      encyclopedia: encyclopediaRes.rows,
      solo_state: gameState,
      ai_available: dmService.isEnabled(),
      encyclopedia_entries: encyclopediaRes.rows.length,
    });
  } catch (error) {
    console.error("[SoloRoutes] Status check failed:", error);
    res.status(500).json({ error: "Failed to get game status" });
  }
});

router.get("/encyclopedia/:campaignId", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.sub;
    const { campaignId } = req.params;
    const { category, search } = req.query;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const charRes = await pool.query(
      "SELECT id FROM public.characters WHERE campaign_id = $1 AND user_id = $2 AND is_alive = true LIMIT 1",
      [campaignId, userId],
    );

    if (charRes.rows.length === 0) {
      return res.status(404).json({ error: "No active character found" });
    }

    const characterId = charRes.rows[0].id;

    let query = `
      SELECT e.*, ck.knowledge_level
      FROM public.encyclopedia_entries e
      JOIN public.character_knowledge ck ON ck.entry_id = e.id
      WHERE ck.character_id = $1 AND e.campaign_id = $2
    `;
    const params: unknown[] = [characterId, campaignId];
    let paramIdx = 3;

    if (category) {
      query += ` AND e.category = $${paramIdx}`;
      params.push(category);
      paramIdx++;
    }

    if (search) {
      query += ` AND (e.title ILIKE $${paramIdx} OR e.summary ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    query += ` ORDER BY e.pinned DESC, e.importance DESC LIMIT 50`;

    const entriesRes = await pool.query(query, params);

    res.json({
      entries: entriesRes.rows,
      count: entriesRes.rows.length,
      character_id: characterId,
    });
  } catch (error) {
    console.error("[SoloRoutes] Encyclopedia fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch encyclopedia" });
  }
});

router.post("/heartbeat", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.sub;
    const { campaign_id, is_rest = false } = req.body;

    if (!userId || !campaign_id) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const memberCheck = await pool.query(
      "SELECT 1 FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
      [campaign_id, userId],
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: "Not a member of this campaign" });
    }

    await runWorldHeartbeat(pool, campaign_id, is_rest);

    res.json({
      success: true,
      message: is_rest ? "Rest completed. World updated." : "World heartbeat processed.",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[SoloRoutes] Heartbeat failed:", error);
    res.status(500).json({ error: "World update failed" });
  }
});

router.post("/end", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.sub;
    const { campaign_id } = req.body;

    if (!userId || !campaign_id) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const campaignRes = await pool.query(
      "SELECT owner_id FROM public.campaigns WHERE id = $1",
      [campaign_id],
    );

    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    if (campaignRes.rows[0].owner_id !== userId) {
      return res.status(403).json({ error: "Only owner can end campaign" });
    }

    endSoloGame(campaign_id);

    await pool.query(
      `UPDATE public.campaigns
       SET world_state = COALESCE(world_state, '{}'::jsonb) || '{"ended": true}'::jsonb
       WHERE id = $1`,
      [campaign_id],
    );

    res.json({
      success: true,
      message: "Solo adventure ended. Your legend is preserved in the encyclopedia.",
    });
  } catch (error) {
    console.error("[SoloRoutes] End campaign failed:", error);
    res.status(500).json({ error: "Failed to end campaign" });
  }
});

router.get("/character-options", async (_req, res: Response) => {
  res.json({
    races: ["Human", "Elf", "Dwarf", "Halfling", "Half-Orc", "Tiefling"],
    classes: ["Fighter", "Wizard", "Rogue", "Cleric", "Barbarian", "Ranger"],
    starting_equipment: {
      Fighter: ["Longsword", "Shield", "Chain Mail", "Explorer's Pack"],
      Wizard: ["Quarterstaff", "Spellbook", "Component Pouch", "Scholar's Pack"],
      Rogue: ["Rapier", "Shortbow", "Leather Armor", "Thieves' Tools"],
      Cleric: ["Mace", "Scale Mail", "Shield", "Holy Symbol"],
      Barbarian: ["Greataxe", "Handaxes (2)", "Javelins (4)", "Explorer's Pack"],
      Ranger: ["Longsword", "Shortsword", "Longbow", "Leather Armor"],
    },
  });
});

export default router;
