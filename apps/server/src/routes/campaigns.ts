import { Router, Response } from "express";
import { PoolClient } from "pg";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { pool } from "../db/client";

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

  // Seed initial NPCs for testing/immersion
  await client.query(
    `INSERT INTO public.npcs (campaign_id, name, role, location_id, is_alive, relationship_map, base_stats)
     VALUES
     ($1, $2, $3, $4, true, $5, $6),
     ($7, $8, $9, $10, true, $11, $12),
     ($13, $14, $15, $16, true, $17, $18)`,
    [
      campaignId, 'Eldric Ironhammer', 'Blacksmith', townId, '{}', JSON.stringify({ str: 18, cha: 12 }),
      campaignId, 'Mira Shadowstep', 'Scout', wildernessId, '{}', JSON.stringify({ dex: 16, int: 14 }),
      campaignId, 'Brother Thorne', 'Cleric', townId, '{}', JSON.stringify({ wis: 16, con: 14 })
    ]
  );
}

// POST /api/campaigns - Create a new campaign
router.post("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { name } = req.body;
  const userId = req.user?.sub;

  if (!name) {
    return res.status(400).json({ error: "Missing campaign name" });
  }

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Start transaction since we insert into both campaigns and campaign_members
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let inviteCode = generateInviteCode();
    // Verify uniqueness of invite code
    let codeCheck = await client.query("SELECT 1 FROM public.campaigns WHERE invite_code = $1", [inviteCode]);
    let attempts = 0;
    while (codeCheck.rows.length > 0 && attempts < 5) {
      inviteCode = generateInviteCode();
      codeCheck = await client.query("SELECT 1 FROM public.campaigns WHERE invite_code = $1", [inviteCode]);
      attempts++;
    }

    // 1. Create campaign
    const campaignRes = await client.query(
      "INSERT INTO public.campaigns (name, invite_code, owner_id) VALUES ($1, $2, $3) RETURNING *",
      [name, inviteCode, userId]
    );
    const campaign = campaignRes.rows[0];

    await seedStartingWorld(client, campaign.id);

    // 2. Add owner as the DM in campaign_members
    await client.query(
      "INSERT INTO public.campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')",
      [campaign.id, userId]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Campaign created successfully",
      campaign,
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

export default router;
