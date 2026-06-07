import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { RACES, CLASSES, SKILLS, SKILL_TO_ATTRIBUTE } from "@dnd/shared";
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

async function verifyCharacterAccess(characterId: string, userId: string) {
  const charRes = await pool.query(
    `SELECT c.*, cm.role
     FROM public.characters c
     JOIN public.campaign_members cm ON cm.campaign_id = c.campaign_id AND cm.user_id = $2
     WHERE c.id = $1`,
    [characterId, userId]
  );

  if (charRes.rows.length === 0) {
    return null;
  }

  return charRes.rows[0];
}

async function logInventoryEvent(
  campaignId: string,
  characterId: string,
  characterName: string,
  action: "add" | "drop" | "equip" | "unequip",
  itemName: string,
  quantity = 1
) {
  await pool.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'system', $2, $3)",
    [
      campaignId,
      characterId,
      JSON.stringify({
        action_type: `inventory_${action}`,
        actor_name: characterName,
        item_name: itemName,
        quantity,
        text: `${characterName} ${action === "add" ? "received" : action === "drop" ? "dropped" : action === "equip" ? "equipped" : "unequipped"} ${quantity > 1 ? `${quantity}x ` : ""}${itemName}.`,
      }),
    ]
  );
}

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

    const starterItems = ["Dagger", "Leather Armor", "Rope", "Torch"];
    const starterCatalogRes = await client.query(
      "SELECT id, name FROM public.item_catalog WHERE name = ANY($1::text[])",
      [starterItems]
    );

    for (const item of starterCatalogRes.rows) {
      await client.query(
        "INSERT INTO public.inventory_items (character_id, item_id, quantity, is_equipped) VALUES ($1, $2, 1, $3)",
        [character.id, item.id, item.name === "Leather Armor"]
      );
    }

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

// GET /api/characters/item-catalog - List server-known starter items
router.get("/item-catalog", authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const itemsRes = await pool.query(
      "SELECT * FROM public.item_catalog ORDER BY type ASC, name ASC"
    );
    res.json({ items: itemsRes.rows });
  } catch (error) {
    console.error("List item catalog error:", error);
    res.status(500).json({ error: "Internal server error fetching item catalog" });
  }
});

// GET /api/characters/:id/inventory - List character inventory
router.get("/:id/inventory", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const characterId = req.params.id;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const character = await verifyCharacterAccess(characterId, userId);
    if (!character) {
      return res.status(403).json({ error: "Forbidden: You cannot access this character inventory" });
    }

    const inventoryRes = await pool.query(
      `SELECT ii.id, ii.character_id, ii.item_id, ii.quantity, ii.is_equipped, ii.acquired_at,
              ic.name, ic.type, ic.description, ic.stats, ic.value_gp, ic.is_consumable
       FROM public.inventory_items ii
       JOIN public.item_catalog ic ON ic.id = ii.item_id
       WHERE ii.character_id = $1
       ORDER BY ii.is_equipped DESC, ic.type ASC, ic.name ASC`,
      [characterId]
    );

    res.json({ inventory: inventoryRes.rows });
  } catch (error) {
    console.error("List inventory error:", error);
    res.status(500).json({ error: "Internal server error fetching inventory" });
  }
});

// POST /api/characters/:id/inventory - Server-authorized item grant
router.post("/:id/inventory", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const characterId = req.params.id;
  const userId = req.user?.sub;
  const { item_id, item_name, quantity = 1 } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!item_id && !item_name) {
    return res.status(400).json({ error: "Missing item_id or item_name" });
  }

  const safeQuantity = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;

  try {
    const character = await verifyCharacterAccess(characterId, userId);
    if (!character || (character.user_id !== userId && character.role !== "dm")) {
      return res.status(403).json({ error: "Forbidden: Only the character owner or DM can receive items" });
    }

    const itemRes = await pool.query(
      item_id
        ? "SELECT * FROM public.item_catalog WHERE id = $1"
        : "SELECT * FROM public.item_catalog WHERE lower(name) = lower($1)",
      [item_id || item_name]
    );

    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: "Item not found in catalog" });
    }

    const item = itemRes.rows[0];
    const inventoryRes = await pool.query(
      `INSERT INTO public.inventory_items (character_id, item_id, quantity)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [characterId, item.id, safeQuantity]
    );

    await logInventoryEvent(character.campaign_id, characterId, character.name, "add", item.name, safeQuantity);

    res.status(201).json({ inventory_item: inventoryRes.rows[0], item });
  } catch (error) {
    console.error("Add inventory item error:", error);
    res.status(500).json({ error: "Internal server error adding inventory item" });
  }
});

// DELETE /api/characters/:id/inventory/:itemId - Drop inventory item
router.delete("/:id/inventory/:itemId", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const characterId = req.params.id;
  const inventoryItemId = req.params.itemId;
  const userId = req.user?.sub;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const character = await verifyCharacterAccess(characterId, userId);
    if (!character || (character.user_id !== userId && character.role !== "dm")) {
      return res.status(403).json({ error: "Forbidden: Only the character owner or DM can drop items" });
    }

    const deletedRes = await pool.query(
      `DELETE FROM public.inventory_items ii
       USING public.item_catalog ic
       WHERE ii.item_id = ic.id AND ii.id = $1 AND ii.character_id = $2
       RETURNING ii.*, ic.name`,
      [inventoryItemId, characterId]
    );

    if (deletedRes.rows.length === 0) {
      return res.status(404).json({ error: "Inventory item not found" });
    }

    await logInventoryEvent(
      character.campaign_id,
      characterId,
      character.name,
      "drop",
      deletedRes.rows[0].name,
      deletedRes.rows[0].quantity
    );

    res.json({ message: "Item dropped", item: deletedRes.rows[0] });
  } catch (error) {
    console.error("Drop inventory item error:", error);
    res.status(500).json({ error: "Internal server error dropping inventory item" });
  }
});

// PATCH /api/characters/:id/inventory/:itemId/equip - Toggle equipped state
router.patch("/:id/inventory/:itemId/equip", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const characterId = req.params.id;
  const inventoryItemId = req.params.itemId;
  const userId = req.user?.sub;
  const { is_equipped } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (typeof is_equipped !== "boolean") {
    return res.status(400).json({ error: "is_equipped must be a boolean" });
  }

  const client = await pool.connect();
  try {
    const character = await verifyCharacterAccess(characterId, userId);
    if (!character || (character.user_id !== userId && character.role !== "dm")) {
      return res.status(403).json({ error: "Forbidden: Only the character owner or DM can equip items" });
    }

    await client.query("BEGIN");

    const currentItemRes = await client.query(
      `SELECT ii.id, ic.name, ic.type
       FROM public.inventory_items ii
       JOIN public.item_catalog ic ON ic.id = ii.item_id
       WHERE ii.id = $1 AND ii.character_id = $2`,
      [inventoryItemId, characterId]
    );

    if (currentItemRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Inventory item not found" });
    }

    const item = currentItemRes.rows[0];

    if (is_equipped && item.type === "armor") {
      await client.query(
        `UPDATE public.inventory_items ii
         SET is_equipped = false
         FROM public.item_catalog ic
         WHERE ii.item_id = ic.id
           AND ii.character_id = $1
           AND ic.type = 'armor'
           AND (ic.stats ? 'ac_base')
           AND ii.id <> $2`,
        [characterId, inventoryItemId]
      );
    }

    const updatedRes = await client.query(
      "UPDATE public.inventory_items SET is_equipped = $1 WHERE id = $2 AND character_id = $3 RETURNING *",
      [is_equipped, inventoryItemId, characterId]
    );

    await client.query("COMMIT");

    await logInventoryEvent(
      character.campaign_id,
      characterId,
      character.name,
      is_equipped ? "equip" : "unequip",
      item.name
    );

    res.json({ inventory_item: updatedRes.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Toggle inventory equip error:", error);
    res.status(500).json({ error: "Internal server error updating inventory item" });
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

// POST /api/characters/:id/allocate-stats - Allocate ability score points (ASI)
router.post("/:id/allocate-stats", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const characterId = req.params.id;
  const userId = req.user?.sub;
  const { attributes: newAttributes } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!newAttributes || typeof newAttributes !== "object") {
    return res.status(400).json({ error: "Missing or invalid attributes in request body" });
  }

  try {
    const character = await verifyCharacterAccess(characterId, userId);
    if (!character) {
      return res.status(403).json({ error: "Forbidden: You cannot modify this character" });
    }

    if (!character.is_alive) {
      return res.status(400).json({ error: "Cannot allocate stats for a deceased character" });
    }

    // 1. Check if campaign has active combat
    const combatCheck = await pool.query(
      "SELECT id FROM public.combat_encounters WHERE campaign_id = $1 AND status = 'active' LIMIT 1",
      [character.campaign_id]
    );
    if (combatCheck.rows.length > 0) {
      return res.status(400).json({ error: "Cannot allocate stats while campaign is in active combat" });
    }

    // 2. Fetch class starting stats
    const defaults = CLASS_STARTING_STATS[character.class];
    if (!defaults) {
      return res.status(500).json({ error: "Starting stats config not found for character class" });
    }

    const startingClassStats = defaults.attributes;
    const startingClassStatsSum = Object.values(startingClassStats).reduce((s, v) => s + v, 0);

    const currentAttributes = character.attributes as Record<string, number>;
    const currentAttributesSum = Object.values(currentAttributes).reduce((s: number, v: number) => s + v, 0);

    const level = character.level;
    const allowedTotalPoints = startingClassStatsSum + 2 * (level - 1);
    const availablePoints = allowedTotalPoints - currentAttributesSum;

    // 3. Validate new attributes format and values
    const attrs = ["str", "dex", "con", "int", "wis", "cha"];
    let newSum = 0;
    for (const attr of attrs) {
      const val = newAttributes[attr];
      if (typeof val !== "number" || !Number.isInteger(val)) {
        return res.status(400).json({ error: `Attribute '${attr}' must be an integer` });
      }
      if (val < currentAttributes[attr]) {
        return res.status(400).json({ error: `Attribute '${attr}' cannot be decreased below current value (${currentAttributes[attr]})` });
      }
      if (val > 20) {
        return res.status(400).json({ error: `Attribute '${attr}' cannot exceed the maximum cap of 20` });
      }
      newSum += val;
    }

    const change = newSum - currentAttributesSum;
    if (change < 0) {
      return res.status(400).json({ error: "Invalid allocation: total stats cannot decrease" });
    }
    if (change > availablePoints) {
      return res.status(400).json({ error: `Insufficient stat points available. Requested increase of ${change} but only ${availablePoints} available.` });
    }

    // 4. Recompute all 18 skill modifiers
    const updatedSkills: Record<string, number> = {};
    for (const skill of SKILLS) {
      const assocAttr = SKILL_TO_ATTRIBUTE[skill];
      const attrVal = newAttributes[assocAttr];
      updatedSkills[skill] = Math.floor((attrVal - 10) / 2);
    }

    // 5. Update database and log event
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      const updateRes = await dbClient.query(
        `UPDATE public.characters 
         SET attributes = $1, skills = $2, updated_at = now()
         WHERE id = $3 
         RETURNING *`,
        [JSON.stringify(newAttributes), JSON.stringify(updatedSkills), characterId]
      );

      const updatedCharacter = updateRes.rows[0];

      // Log system event
      const logPayload = {
        action_type: "stat_allocation",
        actor_name: character.name,
        text: `${character.name} allocated ability scores: STR ${newAttributes.str}, DEX ${newAttributes.dex}, CON ${newAttributes.con}, INT ${newAttributes.int}, WIS ${newAttributes.wis}, CHA ${newAttributes.cha}.`,
      };
      await dbClient.query(
        "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'system', $2, $3)",
        [character.campaign_id, characterId, JSON.stringify(logPayload)]
      );

      await dbClient.query("COMMIT");

      res.json({
        message: "Stats allocated successfully",
        character: updatedCharacter,
      });
    } catch (err) {
      await dbClient.query("ROLLBACK");
      throw err;
    } finally {
      dbClient.release();
    }
  } catch (error) {
    console.error("Allocate stats error:", error);
    res.status(500).json({ error: "Internal server error allocating stats" });
  }
});

export default router;
