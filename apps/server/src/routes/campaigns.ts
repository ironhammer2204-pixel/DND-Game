import { Router, Response } from "express";
import { PoolClient } from "pg";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { pool } from "../db/client";
import { RoomManager } from "../websocket/roomManager";
import {
  expandWorldWithAI,
  persistWorldExpansion,
  regenerateElement,
  WorldExpansionInput,
} from "../game/worldExpansionEngine";
import { buildCampaignSnapshot, buildCampaignMeta } from "../ai/contextBuilder";
import { buildOpeningNarrationPrompt } from "../ai/promptTemplates";
import { dmService } from "../ai/dmService";
import { rollDie, broadcastDiceRoll } from "../game/diceEngine";

const router = Router();

// Helper to generate a random 6-character uppercase alphanumeric code
function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function getMembership(campaignId: string, userId: string) {
  const memberCheck = await pool.query(
    "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
    [campaignId, userId]
  );

  return memberCheck.rows[0] || null;
}

async function seedStartingWorld(client: PoolClient, campaignId: string) {
  const townRes = await client.query(
    `INSERT INTO public.locations (campaign_id, name, type, description, state, lore)
     VALUES ($1, 'Emberfall Village', 'village', $2, $3, $4)
     RETURNING id`,
    [
      campaignId,
      'A lantern-lit frontier village with a busy tavern, a wary watchtower, and muddy roads leading into wild country.',
      JSON.stringify({ discovered: true }),
      'Emberfall was founded beside old dwarven mile markers that point toward ruins in the eastern hills.',
    ]
  );
  const townId = townRes.rows[0].id;

  const wildernessRes = await client.query(
    `INSERT INTO public.locations (campaign_id, name, type, description, state, lore)
     VALUES ($1, 'Briarwood Wilds', 'wilderness', $2, $3, $4)
     RETURNING id`,
    [
      campaignId,
      'A stretch of dense forest, broken cart paths, and misty gullies where tracks disappear quickly after rain.',
      JSON.stringify({ discovered: false }),
      'Travelers claim old campfires sometimes glow here without anyone tending them.',
    ]
  );
  const wildernessId = wildernessRes.rows[0].id;

  const dungeonRes = await client.query(
    `INSERT INTO public.locations (campaign_id, name, type, description, state, lore)
     VALUES ($1, 'Ashen Gate Ruins', 'dungeon', $2, $3, $4)
     RETURNING id`,
    [
      campaignId,
      'A collapsed stone archway half-buried in thorn roots, opening into stairs that breathe cold air from below.',
      JSON.stringify({ discovered: false }),
      'The Ashen Gate was sealed after a mining company vanished beneath it three generations ago.',
    ]
  );
  const dungeonId = dungeonRes.rows[0].id;

  await client.query("UPDATE public.locations SET connected_locations = $1::uuid[] WHERE id = $2", [
    [wildernessId],
    townId,
  ]);
  await client.query("UPDATE public.locations SET connected_locations = $1::uuid[] WHERE id = $2", [
    [townId, dungeonId],
    wildernessId,
  ]);
  await client.query("UPDATE public.locations SET connected_locations = $1::uuid[] WHERE id = $2", [
    [wildernessId],
    dungeonId,
  ]);

  const worldState = {
    starting_location_id: townId,
    discovered_location_ids: [townId],
    character_locations: {},
  };

  await client.query("UPDATE public.campaigns SET world_state = $1 WHERE id = $2", [
    JSON.stringify(worldState),
    campaignId,
  ]);

  // Seed initial NPCs for testing/immersion and extract Eldric's ID
  const npcRes = await client.query(
    `INSERT INTO public.npcs (campaign_id, name, role, location_id, is_alive, relationship_map, base_stats)
     VALUES
     ($1, $2, $3, $4, true, $5, $6),
     ($7, $8, $9, $10, true, $11, $12),
     ($13, $14, $15, $16, true, $17, $18)
     RETURNING id, name`,
    [
      campaignId, 'Eldric Ironhammer', 'Blacksmith', townId, '{}', JSON.stringify({ str: 18, cha: 12 }),
      campaignId, 'Mira Shadowstep', 'Scout', wildernessId, '{}', JSON.stringify({ dex: 16, int: 14 }),
      campaignId, 'Brother Thorne', 'Cleric', townId, '{}', JSON.stringify({ wis: 16, con: 14 })
    ]
  );
  const townNpcId = npcRes.rows.find((n) => n.name === "Eldric Ironhammer")?.id;

  // Seed initial Faction aligning with database columns
  await client.query(
    `INSERT INTO public.factions
     (campaign_id, name, type, personality, disposition, power_level, description, is_hidden, military, wealth, influence, stability, pressure, pressure_cap, objectives, victory_condition, is_victorious, collapsed)
     VALUES ($1, 'Blackwater Syndicate', 'criminal', 'expansionist', 'hostile', 15, 'A ruthless crime syndicate controlling the local black market.', false, 15, 30, 10, 80, 0, 1000, '[]'::jsonb, '{}'::jsonb, false, false)`,
    [campaignId]
  );

  // Seed initial Quest linked to Eldric Ironhammer
  const objectives = [
    { text: "Travel to the Bandit Camp", completed: false },
    { text: "Eliminate 5 Blackwater Syndicate bandits", completed: false }
  ];
  await client.query(
    `INSERT INTO public.quests (campaign_id, type, title, description, objectives, rewards, status, giver_npc_id)
     VALUES ($1, 'side', 'Clear the Bandit Hideout', 'The local blacksmith needs you to eliminate outlaws threatening the trade routes.', $2::jsonb, $3::jsonb, 'active', $4)`,
    [campaignId, JSON.stringify(objectives), JSON.stringify({ gold: 150, xp: 200 }), townNpcId]
  );

  // Seed initial Encyclopedia Entry with tags bound as postgres array
  await client.query(
    `INSERT INTO public.encyclopedia_entries (campaign_id, category, title, subtitle, summary, full_content, importance, tags, is_secret, pinned)
     VALUES ($1, 'location', 'The Ashen Gate', 'An ancient stone archway sealed by magic', 'A collapsed structure of dark basalt columns in the hills.', '{}'::jsonb, 3, $2::text[], false, true)`,
    [campaignId, ['ruins', 'dungeon']]
  );
}

// POST /api/campaigns - Create a new campaign
router.post("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const {
    name,
    tone,
    setting,
    hook,
    themes,
    party_size,
    starting_level,
    difficulty,
    use_setup_wizard,
  } = req.body;
  const userId = req.user?.sub;

  if (!name) {
    return res.status(400).json({ error: "Missing campaign name" });
  }

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const setupWizard = Boolean(use_setup_wizard || tone || setting);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let inviteCode = generateInviteCode();
    let codeCheck = await client.query("SELECT 1 FROM public.campaigns WHERE invite_code = $1", [inviteCode]);
    let attempts = 0;
    while (codeCheck.rows.length > 0 && attempts < 5) {
      inviteCode = generateInviteCode();
      codeCheck = await client.query("SELECT 1 FROM public.campaigns WHERE invite_code = $1", [inviteCode]);
      attempts++;
    }

    const settings = setupWizard
      ? {
          tone: tone || "dark",
          setting: setting || "",
          hook: hook || "",
          themes: themes || [],
          party_size: party_size || 4,
          starting_level: starting_level || 1,
          difficulty: difficulty || "standard",
        }
      : {};

    const campaignRes = await client.query(
      `INSERT INTO public.campaigns (name, invite_code, owner_id, settings, world_state, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        inviteCode,
        userId,
        JSON.stringify(settings),
        JSON.stringify(setupWizard ? { setup_phase: true } : {}),
        setupWizard ? "setup" : "active",
      ],
    );
    const campaign = campaignRes.rows[0];

    if (setupWizard) {
      const townRes = await client.query(
        `INSERT INTO public.locations (campaign_id, name, type, description, state, lore, danger_level)
         VALUES ($1, 'Starting Settlement', 'village', $2, $3, $4, 'low')
         RETURNING id`,
        [
          campaign.id,
          "A placeholder settlement until world expansion completes.",
          JSON.stringify({ discovered: true, is_starting_location: true }),
          "Temporary starting point for the setup wizard.",
        ],
      );
      await client.query(
        `UPDATE public.campaigns
         SET current_location_id = $1,
             world_state = COALESCE(world_state, '{}'::jsonb) || $2::jsonb
         WHERE id = $3`,
        [
          townRes.rows[0].id,
          JSON.stringify({
            starting_location_id: townRes.rows[0].id,
            discovered_location_ids: [townRes.rows[0].id],
          }),
          campaign.id,
        ],
      );
    } else {
      await seedStartingWorld(client, campaign.id);
    }

    await client.query(
      "INSERT INTO public.campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')",
      [campaign.id, userId],
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: setupWizard
        ? "Campaign created. Proceed to world expansion."
        : "Campaign created successfully",
      campaign,
      next_step: setupWizard ? "POST /api/campaigns/:id/expand-world" : undefined,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create campaign error:", error);
    res.status(500).json({ error: "Internal server error creating campaign" });
  } finally {
    client.release();
  }
});

// POST /api/campaigns/join - Join a campaign via invite code
router.post("/join", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { invite_code } = req.body;
  const userId = req.user?.sub;
  const inviteCode = typeof invite_code === "string" ? invite_code.trim().toUpperCase() : "";

  if (!inviteCode) {
    return res.status(400).json({ error: "Missing invite code" });
  }

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Find campaign by invite code
    const campaignRes = await pool.query(
      "SELECT id, name, invite_code, owner_id FROM public.campaigns WHERE invite_code = $1",
      [inviteCode]
    );

    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found with the provided invite code" });
    }

    const campaign = campaignRes.rows[0];

    // 2. Check if already a member
    const memberCheck = await pool.query(
      "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
      [campaign.id, userId]
    );

    if (memberCheck.rows.length > 0) {
      await pool.query(
        "UPDATE public.campaign_members SET last_seen_at = now() WHERE campaign_id = $1 AND user_id = $2",
        [campaign.id, userId]
      );

      return res.status(200).json({
        message: "You are already a member of this campaign",
        campaign,
        role: memberCheck.rows[0].role,
      });
    }

    // Determine role: if owner, they are 'dm', else 'player'
    const role = campaign.owner_id === userId ? "dm" : "player";

    // 3. Add to campaign members
    await pool.query(
      "INSERT INTO public.campaign_members (campaign_id, user_id, role) VALUES ($1, $2, $3)",
      [campaign.id, userId, role]
    );

    res.status(200).json({
      message: "Successfully joined the campaign",
      campaign,
      role,
    });
  } catch (error) {
    console.error("Join campaign error:", error);
    res.status(500).json({ error: "Internal server error joining campaign" });
  }
});

// GET /api/campaigns - List campaigns user is a member of
router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const campaignsRes = await pool.query(
      `SELECT c.*, cm.role, cm.joined_at, u.username as owner_name
       FROM public.campaigns c
       JOIN public.campaign_members cm ON c.id = cm.campaign_id
       JOIN public.users u ON c.owner_id = u.id
       WHERE cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );

    res.json({ campaigns: campaignsRes.rows });
  } catch (error) {
    console.error("List campaigns error:", error);
    res.status(500).json({ error: "Internal server error fetching campaigns" });
  }
});

// GET /api/campaigns/:id/members - List campaign members with linked character info
router.get("/:id/members", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const campaignId = req.params.id;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const membership = await getMembership(campaignId, userId);
    if (!membership) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    const membersRes = await pool.query(
      `SELECT cm.campaign_id, cm.user_id, cm.character_id, cm.role, cm.joined_at, cm.last_seen_at,
              u.username, u.email,
              c.name AS character_name, c.race, c.class, c.level, c.is_alive
       FROM public.campaign_members cm
       JOIN public.users u ON u.id = cm.user_id
       LEFT JOIN public.characters c ON c.id = cm.character_id
       WHERE cm.campaign_id = $1
       ORDER BY cm.role DESC, cm.joined_at ASC`,
      [campaignId]
    );

    res.json({ members: membersRes.rows });
  } catch (error) {
    console.error("List campaign members error:", error);
    res.status(500).json({ error: "Internal server error fetching campaign members" });
  }
});

// GET /api/campaigns/:id/events - Load recent persistent campaign events for reconnect/catch-up
router.get("/:id/events", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const campaignId = req.params.id;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const membership = await getMembership(campaignId, userId);
    if (!membership) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    const eventsRes = await pool.query(
      `SELECT e.id, e.campaign_id, e.type, e.actor_id, e.payload, e.ai_narration, e.created_at,
              COALESCE(c.name, u.username) AS actor_name
       FROM public.event_log e
       LEFT JOIN public.characters c ON c.id = e.actor_id
       LEFT JOIN public.users u ON u.id = c.user_id
       WHERE e.campaign_id = $1
       ORDER BY e.created_at DESC
       LIMIT 50`,
      [campaignId]
    );

    res.json({ events: eventsRes.rows.reverse() });
  } catch (error) {
    console.error("List campaign events error:", error);
    res.status(500).json({ error: "Internal server error fetching campaign events" });
  }
});

// GET /api/campaigns/:id/world - Return locations and campaign world state
router.get("/:id/world", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const campaignId = req.params.id;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const membership = await getMembership(campaignId, userId);
    if (!membership) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    const campaignRes = await pool.query("SELECT world_state FROM public.campaigns WHERE id = $1", [campaignId]);
    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const locationsRes = await pool.query(
      `SELECT id, campaign_id, name, type, description, state, connected_locations, lore
       FROM public.locations
       WHERE campaign_id = $1
       ORDER BY name ASC`,
      [campaignId]
    );

    res.json({
      world_state: campaignRes.rows[0].world_state,
      locations: locationsRes.rows,
    });
  } catch (error) {
    console.error("Get campaign world error:", error);
    res.status(500).json({ error: "Internal server error fetching campaign world" });
  }
});

// GET /api/campaigns/:id/locations/:locationId/npcs - Get NPCs at a specific location
router.get("/:id/locations/:locationId/npcs", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { id: campaignId, locationId } = req.params;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const membership = await getMembership(campaignId, userId);
    if (!membership) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    const npcsRes = await pool.query(
      `SELECT id, campaign_id, name, role, location_id, is_alive, relationship_map, base_stats
       FROM public.npcs
       WHERE campaign_id = $1 AND location_id = $2 AND is_alive = true
       ORDER BY name ASC`,
      [campaignId, locationId]
    );

    res.json({ npcs: npcsRes.rows });
  } catch (error) {
    console.error("Get location NPCs error:", error);
    res.status(500).json({ error: "Internal server error fetching NPCs" });
  }
});

// GET /api/campaigns/:id - Get full campaign state (requires membership check)
router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const campaignId = req.params.id;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Verify user membership in this campaign
    const membership = await getMembership(campaignId, userId);

    if (!membership) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    // 2. Fetch full campaign details
    const campaignRes = await pool.query(
      `SELECT c.*, u.username as owner_name
       FROM public.campaigns c
       JOIN public.users u ON c.owner_id = u.id
       WHERE c.id = $1`,
      [campaignId]
    );

    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const membersRes = await pool.query(
      `SELECT cm.campaign_id, cm.user_id, cm.character_id, cm.role, cm.joined_at, cm.last_seen_at,
              u.username,
              c.name AS character_name, c.race, c.class, c.level, c.is_alive
       FROM public.campaign_members cm
       JOIN public.users u ON u.id = cm.user_id
       LEFT JOIN public.characters c ON c.id = cm.character_id
       WHERE cm.campaign_id = $1
       ORDER BY cm.role DESC, cm.joined_at ASC`,
      [campaignId]
    );

    res.json({
      campaign: campaignRes.rows[0],
      role: membership.role,
      members: membersRes.rows,
    });
  } catch (error) {
    console.error("Get campaign details error:", error);
    res.status(500).json({ error: "Internal server error fetching campaign details" });
  }
});

// GET /api/campaigns/:id/quests - Fetch campaign quests
router.get("/:id/quests", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const campaignId = req.params.id;
  const userId = req.user?.sub;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const membership = await getMembership(campaignId, userId);
    if (!membership) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    const questsRes = await pool.query(
      `SELECT * FROM public.quests WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [campaignId]
    );

    res.json({ quests: questsRes.rows });
  } catch (error) {
    console.error("Fetch quests error:", error);
    res.status(500).json({ error: "Internal server error fetching quests" });
  }
});

// PATCH /api/campaigns/:id/quests/:questId/objective - Update quest objective completion
router.patch("/:id/quests/:questId/objective", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { id: campaignId, questId } = req.params;
  const userId = req.user?.sub;
  const { objective_index, completed } = req.body;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const membership = await getMembership(campaignId, userId);
    if (!membership || membership.role !== "dm") {
      return res.status(403).json({ error: "Forbidden: Only the DM can update quest objectives" });
    }

    const questCheck = await pool.query(
      `SELECT * FROM public.quests WHERE id = $1 AND campaign_id = $2`,
      [questId, campaignId]
    );

    if (questCheck.rows.length === 0) {
      return res.status(404).json({ error: "Quest not found" });
    }

    const quest = questCheck.rows[0];
    const objectives = typeof quest.objectives === "string" ? JSON.parse(quest.objectives) : quest.objectives;

    if (objective_index < 0 || objective_index >= objectives.length) {
      return res.status(400).json({ error: "Invalid objective index" });
    }

    objectives[objective_index].completed = completed;

    // Check if all objectives are completed to transition status
    const allCompleted = objectives.every((obj: any) => obj.completed);
    const newStatus = allCompleted ? "complete" : "active";

    const updateRes = await pool.query(
      `UPDATE public.quests
       SET objectives = $1::jsonb, status = $2, completed_at = $3
       WHERE id = $4 AND campaign_id = $5
       RETURNING *`,
      [
        JSON.stringify(objectives),
        newStatus,
        newStatus === "complete" ? new Date() : null,
        questId,
        campaignId
      ]
    );

    const updatedQuest = updateRes.rows[0];

    // Broadcast quest update to the room
    RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: updatedQuest });

    res.json({ quest: updatedQuest });
  } catch (error) {
    console.error("Update quest objective error:", error);
    res.status(500).json({ error: "Internal server error updating quest" });
  }
});

router.patch("/:id/settings", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { id: campaignId } = req.params;
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const membership = await getMembership(campaignId, userId);
  if (!membership || membership.role !== "dm") {
    return res.status(403).json({ error: "DM role required" });
  }

  const { name, ...settingsPatch } = req.body;
  try {
    if (name) {
      await pool.query("UPDATE public.campaigns SET name = $1 WHERE id = $2", [name, campaignId]);
    }
    if (Object.keys(settingsPatch).length > 0) {
      await pool.query(
        `UPDATE public.campaigns
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify(settingsPatch), campaignId],
      );
    }
    const updated = await pool.query("SELECT * FROM public.campaigns WHERE id = $1", [campaignId]);
    res.json({ campaign: updated.rows[0] });
  } catch (error) {
    console.error("Update campaign settings error:", error);
    res.status(500).json({ error: "Failed to update campaign settings" });
  }
});

router.post("/:id/expand-world", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const membership = await getMembership(campaignId, userId);
    if (!membership || membership.role !== "dm") {
      return res.status(403).json({ error: "DM role required" });
    }

    const campaignRes = await pool.query("SELECT settings FROM public.campaigns WHERE id = $1", [campaignId]);
    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const settings = campaignRes.rows[0].settings || {};
    const input: WorldExpansionInput = {
      tone: settings.tone || req.body.tone || "dark",
      setting: settings.setting || req.body.setting || "a dark frontier",
      hook: settings.hook || req.body.hook || "an ancient evil stirs",
      themes: settings.themes || req.body.themes || [],
      party_size: settings.party_size || req.body.party_size || 4,
      starting_level: settings.starting_level || req.body.starting_level || 1,
      difficulty: settings.difficulty || req.body.difficulty || "standard",
      known_npcs: req.body.known_npcs,
      known_locations: req.body.known_locations,
      villain_archetype: req.body.villain_archetype,
      session_zero_notes: req.body.session_zero_notes,
    };

    const expansionResult = await expandWorldWithAI(input);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ids = await persistWorldExpansion(client, campaignId, expansionResult, input);
      await client.query("COMMIT");

      RoomManager.broadcastToRoom(campaignId, "WORLD_EXPANDED", {
        campaign_id: campaignId,
        locations: expansionResult.locations.length,
        npcs: expansionResult.npcs.length,
        factions: expansionResult.factions.length,
        quests: expansionResult.quests.length,
        world_summary: expansionResult.world_summary,
      });

      res.json({
        success: true,
        world_summary: expansionResult.world_summary,
        opening_narration: expansionResult.opening_narration,
        locations: expansionResult.locations,
        npcs: expansionResult.npcs,
        factions: expansionResult.factions,
        quests: expansionResult.quests,
        random_event_seeds: expansionResult.random_event_seeds,
        nemesis_seed: expansionResult.nemesis_seed,
        persisted_ids: ids,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[campaigns] expand-world error:", error);
    res.status(500).json({ error: "World expansion failed" });
  }
});

router.post("/:id/regenerate-element", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user?.sub;
    const { element_type, element_index } = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const membership = await getMembership(campaignId, userId);
    if (!membership || membership.role !== "dm") {
      return res.status(403).json({ error: "DM role required" });
    }

    const campaignRes = await pool.query("SELECT settings FROM public.campaigns WHERE id = $1", [campaignId]);
    const settings = campaignRes.rows[0]?.settings || {};
    const input: WorldExpansionInput = {
      tone: settings.tone || "dark",
      setting: settings.setting || "",
      hook: settings.hook || "",
      themes: settings.themes || [],
      party_size: settings.party_size || 4,
      starting_level: settings.starting_level || 1,
      difficulty: settings.difficulty || "standard",
    };

    const element = await regenerateElement(pool, campaignId, element_type, element_index, input);
    res.json({ success: true, element_type, element_index, element });
  } catch (error) {
    console.error("[campaigns] regenerate-element error:", error);
    res.status(500).json({ error: "Regeneration failed" });
  }
});

router.post("/:id/launch", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const membership = await getMembership(campaignId, userId);
    if (!membership || membership.role !== "dm") {
      return res.status(403).json({ error: "DM role required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const locCheck = await client.query(
        "SELECT 1 FROM public.locations WHERE campaign_id = $1 AND state->>'is_starting_location' = 'true' LIMIT 1",
        [campaignId],
      );
      const questCheck = await client.query(
        "SELECT 1 FROM public.quests WHERE campaign_id = $1 AND status = 'active' LIMIT 1",
        [campaignId],
      );
      const npcCheck = await client.query(
        "SELECT 1 FROM public.npcs WHERE campaign_id = $1 AND is_alive = true LIMIT 1",
        [campaignId],
      );

      if (locCheck.rows.length === 0 || questCheck.rows.length === 0 || npcCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "World not ready. Call expand-world first." });
      }

      let openingNarration = "";
      const meta = await buildCampaignMeta(client, campaignId);
      const snapshot = await buildCampaignSnapshot(client, campaignId);

      if (dmService.isEnabled() && meta) {
        try {
          const prompt = buildOpeningNarrationPrompt({
            campaign_name: meta.name,
            world_summary: meta.world_summary,
            opening_narration: meta.opening_narration,
            party: snapshot.party,
            starting_location: snapshot.location || { name: "unknown", description: "" },
            active_quests: snapshot.quests,
          });
          openingNarration = await dmService.generateSessionSummary(prompt);
        } catch {
          openingNarration = meta.opening_narration;
        }
      } else {
        openingNarration = meta?.opening_narration || "The adventure begins...";
      }

      await client.query(
        `UPDATE public.campaigns
         SET status = 'active', world_state = COALESCE(world_state, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ launched_at: new Date().toISOString(), opening_narration: openingNarration }), campaignId],
      );

      await client.query("COMMIT");

      const [startingLocRes, questsRes, partyRes] = await Promise.all([
        client.query(
          `SELECT * FROM public.locations
           WHERE campaign_id = $1 AND state->>'is_starting_location' = 'true'
           LIMIT 1`,
          [campaignId],
        ),
        client.query(
          "SELECT * FROM public.quests WHERE campaign_id = $1 AND status = 'active'",
          [campaignId],
        ),
        client.query("SELECT * FROM public.characters WHERE campaign_id = $1", [campaignId]),
      ]);

      RoomManager.broadcastToRoom(campaignId, "CAMPAIGN_LAUNCHED", {
        campaign_id: campaignId,
        opening_narration: openingNarration,
        starting_location: startingLocRes.rows[0] ?? null,
        active_quests: questsRes.rows,
        party: partyRes.rows,
      });

      res.json({ success: true, opening_narration: openingNarration, campaign_id: campaignId, status: "active" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[campaigns] launch error:", error);
    res.status(500).json({ error: "Campaign launch failed" });
  }
});

router.post("/:id/dice/roll", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user?.sub;
    const { dice_type, modifier = 0, context = "Quick Roll" } = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const membership = await getMembership(campaignId, userId);
    if (!membership) return res.status(403).json({ error: "Not a member of this campaign" });

    const validDice = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
    if (!validDice.includes(dice_type)) {
      return res.status(400).json({ error: `Invalid dice type. Use: ${validDice.join(", ")}` });
    }

    const sides = parseInt(String(dice_type).replace("d", ""), 10);
    const raw = rollDie(sides);
    const final = raw + Number(modifier);

    const charRes = await pool.query(
      `SELECT c.name, c.id FROM public.characters c
       JOIN public.campaign_members cm ON cm.character_id = c.id
       WHERE cm.campaign_id = $1 AND cm.user_id = $2 LIMIT 1`,
      [campaignId, userId],
    );
    const rollerName = charRes.rows[0]?.name || req.user?.user_metadata?.username || "Unknown";

    broadcastDiceRoll(campaignId, {
      dice_type,
      raw,
      modifier: Number(modifier),
      final,
      roller_name: rollerName,
      context,
      campaign_id: campaignId,
      character_id: charRes.rows[0]?.id,
      roll_breakdown: { raw_rolls: [raw] },
    });

    res.json({ raw, modifier: Number(modifier), final, dice_type, context });
  } catch (error) {
    console.error("[campaigns] dice roll error:", error);
    res.status(500).json({ error: "Dice roll failed" });
  }
});

export default router;
