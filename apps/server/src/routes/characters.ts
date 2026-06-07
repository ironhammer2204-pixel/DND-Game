import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { RACES, CLASSES, SKILLS } from "@dnd/shared";
import { pool } from "../db/client";

const router = Router();

// Base class configuration for D&D 5e standard starting stats and HP
const CLASS_STARTING_STATS: Record<string, { attributes: Record<string, number>; hp: number }> = {
  Barbarian: { attributes: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 10 }, hp: 14 },
  Bard: { attributes: { str: 8, dex: 14, con: 12, int: 10, wis: 12, cha: 15 }, hp: 9 },
  Cleric: { attributes: { str: 14, dex: 8, con: 12, int: 10, wis: 15, cha: 10 }, hp: 9 },
  Druid: { attributes: { str: 10, dex: 12, con: 13, int: 10, wis: 15, cha: 8 }, hp: 9 },
  Fighter: { attributes: { str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 8 }, hp: 12 },
  Monk: { attributes: { str: 10, dex: 15, con: 12, int: 10, wis: 14, cha: 8 }, hp: 9 },
  Paladin: { attributes: { str: 15, dex: 8, con: 13, int: 10, wis: 12, cha: 14 }, hp: 11 },
  Ranger: { attributes: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 }, hp: 11 },
  Rogue: { attributes: { str: 8, dex: 15, con: 12, int: 13, wis: 10, cha: 14 }, hp: 9 },
  Sorcerer: { attributes: { str: 8, dex: 13, con: 14, int: 10, wis: 10, cha: 15 }, hp: 8 },
  Warlock: { attributes: { str: 8, dex: 13, con: 14, int: 10, wis: 10, cha: 15 }, hp: 10 },
  Wizard: { attributes: { str: 8, dex: 13, con: 14, int: 15, wis: 10, cha: 10 }, hp: 8 },
};

// POST /api/characters - Create a new character
router.post("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { campaign_id, name, race, class: className } = req.body;
  const userId = req.user?.sub;

  if (!campaign_id || !name || !race || !className) {
    return res.status(400).json({ error: "Missing required fields: campaign_id, name, race, class" });
  }

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Validate race and class
  if (!RACES.includes(race)) {
    return res.status(400).json({ error: `Invalid race: ${race}. Supported: ${RACES.join(", ")}` });
  }

  if (!CLASSES.includes(className)) {
    return res.status(400).json({ error: `Invalid class: ${className}. Supported: ${CLASSES.join(", ")}` });
  }

  // 1. Verify user membership in this campaign
  const memberCheck = await pool.query(
    "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
    [campaign_id, userId]
  );

  if (memberCheck.rows.length === 0) {
    return res.status(403).json({ error: "Forbidden: You must join this campaign before creating a character" });
  }

  // Get starting statistics
  const defaults = CLASS_STARTING_STATS[className] || {
    attributes: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    hp: 10,
  };

  // Build skills default map
  const skills: Record<string, number> = {};
  for (const skill of SKILLS) {
    skills[skill] = 0;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 2. Insert character
    const charRes = await client.query(
      `INSERT INTO public.characters 
       (user_id, campaign_id, name, race, class, level, xp, hp_current, hp_max, attributes, skills, gold) 
       VALUES ($1, $2, $3, $4, $5, 1, 0, $6, $6, $7, $8, 15) 
       RETURNING *`,
      [
        userId,
        campaign_id,
        name,
        race,
        className,
        defaults.hp,
        JSON.stringify(defaults.attributes),
        JSON.stringify(skills),
      ]
    );

    const character = charRes.rows[0];

    // 3. Link character to the campaign member slot
    await client.query(
      "UPDATE public.campaign_members SET character_id = $1 WHERE campaign_id = $2 AND user_id = $3",
      [character.id, campaign_id, userId]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Character created successfully",
      character,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create character error:", error);
    res.status(500).json({ error: "Internal server error creating character" });
  } finally {
    client.release();
  }
});

// GET /api/characters/campaign/:campaignId - List all active characters in a campaign
router.get("/campaign/:campaignId", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const campaignId = req.params.campaignId;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Verify user is member of the campaign
    const memberCheck = await pool.query(
      "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
      [campaignId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    const charactersRes = await pool.query(
      `SELECT c.*, u.username
       FROM public.characters c
       JOIN public.users u ON c.user_id = u.id
       WHERE c.campaign_id = $1 AND c.is_alive = true`,
      [campaignId]
    );

    res.json({ characters: charactersRes.rows });
  } catch (error) {
    console.error("List campaign characters error:", error);
    res.status(500).json({ error: "Internal server error fetching campaign characters" });
  }
});

// GET /api/characters/:id - Retrieve character details
router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const characterId = req.params.id;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const charRes = await pool.query(
      "SELECT * FROM public.characters WHERE id = $1",
      [characterId]
    );

    if (charRes.rows.length === 0) {
      return res.status(404).json({ error: "Character not found" });
    }

    const character = charRes.rows[0];

    // Verify requesting user is member of the campaign
    const memberCheck = await pool.query(
      "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
      [character.campaign_id, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: "Forbidden: You are not a member of this campaign" });
    }

    res.json({ character });
  } catch (error) {
    console.error("Get character error:", error);
    res.status(500).json({ error: "Internal server error fetching character" });
  }
});

export default router;
