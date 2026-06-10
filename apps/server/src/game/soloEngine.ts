/**
 * soloEngine.ts
 *
 * Single-player bootstrap and offline mode engine.
 * Provides offline narration fallback, encyclopedia seeding, automated enemy AI,
 * and a REST-friendly solo game loop.
 */

import { Pool, PoolClient } from "pg";
import { pool } from "../db/client";
import { CombatEncounter } from "@dnd/shared";
import { rollDice } from "./diceEngine";
import { dmService } from "../ai/dmService";
import { RoomManager } from "../websocket/roomManager";
import { buildCampaignSnapshot } from "../ai/contextBuilder";
import { startCombat, processCombatAction, getActiveEncounter } from "./combatEngine";
import { runWorldHeartbeat } from "./worldEngine";

type SoloPhase =
  | "initializing"
  | "character_creation"
  | "intro_narration"
  | "exploration"
  | "combat"
  | "rest"
  | "level_up"
  | "game_over";

interface SoloGameState {
  campaignId: string;
  characterId: string;
  userId: string;
  phase: SoloPhase;
  turnCount: number;
  lastActionAt: Date;
  autoSaveInterval: NodeJS.Timeout | null;
  isActive: boolean;
}

const activeSoloGames = new Map<string, SoloGameState>();

function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const OFFLINE_NARRATIONS: Record<string, string[]> = {
  combat_start: [
    "The air grows cold as steel is drawn. Shadows lengthen, and the first clash echoes through the chamber.",
    "From the darkness, enemies emerge. Your heart pounds as combat begins.",
    "The ambush is sprung! Blades flash in the dim light as battle is joined.",
  ],
  combat_victory: [
    "The last foe falls. Silence returns, broken only by your ragged breathing and the whisper of settling dust.",
    "Victory, but at what cost? You stand among the fallen, counting your wounds.",
    "The enemies lie defeated. You emerge from the fray, scarred but triumphant.",
  ],
  combat_defeat: [
    "Darkness claims you. The world fades as you fall, your quest unfinished...",
    "Overwhelmed by the foe, you collapse. The shadows close in.",
    "Your vision blurs. The last thing you see is the enemy standing over you.",
  ],
  movement: [
    "You travel through unfamiliar terrain, each step carrying you deeper into the unknown.",
    "The path winds onward. New sights and sounds fill your senses as you journey.",
    "You press forward, leaving the familiar behind for whatever lies ahead.",
  ],
  skill_check_success: [
    "With practiced ease, you accomplish your task. Success smiles upon you.",
    "Your skill proves sufficient. The challenge yields to your expertise.",
    "A deft maneuver, and the obstacle is overcome. Well done.",
  ],
  skill_check_failure: [
    "Despite your best efforts, the task eludes you. Perhaps another approach?",
    "The challenge proves too great this time. You mark it for future attempts.",
    "Your attempt falls short. The obstacle remains, mocking your failure.",
  ],
  exploration: [
    "The world unfolds before you. Every shadow might hide treasure or danger.",
    "You survey your surroundings, taking in the details of this new place.",
    "Curiosity drives you forward. What secrets lie just out of sight?",
  ],
  rest: [
    "You find a moment of respite. The fire crackles, and your wounds begin to mend.",
    "Rest restores body and mind. You prepare for what tomorrow brings.",
    "In the quiet of camp, you reflect on your journey and plan your next move.",
  ],
  nemesis_ambush: [
    "A shadow falls across your path. You sense a personal vendetta about to unfold.",
    "From the corner of your eye, you catch movement. A familiar threat returns.",
    "The air thickens with malice. An old enemy has found you once more.",
  ],
  default: [
    "The adventure continues, one step at a time.",
    "Fate weaves another thread into your story.",
    "The world turns, and you with it.",
  ],
};

function getOfflineNarration(eventType: string): string {
  const options = OFFLINE_NARRATIONS[eventType] || OFFLINE_NARRATIONS.default;
  return options[Math.floor(Math.random() * options.length)];
}

export async function seedEncyclopediaForSolo(
  client: PoolClient | Pool,
  campaignId: string,
): Promise<void> {
  console.log(`[SoloEngine] Seeding encyclopedia for campaign ${campaignId}`);

  const locations = await client.query(
    `SELECT id, name, type, description, lore
     FROM public.locations
     WHERE campaign_id = $1`,
    [campaignId],
  );

  for (const loc of locations.rows) {
    const existing = await client.query(
      `SELECT 1 FROM public.encyclopedia_entries
       WHERE campaign_id = $1 AND source_type = 'location' AND source_id = $2`,
      [campaignId, loc.id],
    );
    if (existing.rows.length > 0) continue;

    await client.query(
      `INSERT INTO public.encyclopedia_entries
       (campaign_id, category, source_id, source_type, title, subtitle, summary, full_content, importance, is_secret)
       VALUES ($1, 'location', $2, 'location', $3, $4, $5, $6, $7, false)`,
      [
        campaignId,
        loc.id,
        loc.name,
        loc.type === "village" ? "Frontier Settlement" : "Wild Region",
        loc.description,
        JSON.stringify({ lore: loc.lore, type: loc.type }),
        loc.type === "dungeon" ? 45 : loc.type === "wilderness" ? 25 : 30,
      ],
    );
  }

  const npcs = await client.query(
    `SELECT id, name, role, base_stats
     FROM public.npcs
     WHERE campaign_id = $1 AND is_alive = true`,
    [campaignId],
  );

  for (const npc of npcs.rows) {
    const existing = await client.query(
      `SELECT 1 FROM public.encyclopedia_entries
       WHERE campaign_id = $1 AND source_type = 'npc' AND source_id = $2`,
      [campaignId, npc.id],
    );
    if (existing.rows.length > 0) continue;

    await client.query(
      `INSERT INTO public.encyclopedia_entries
       (campaign_id, category, source_id, source_type, title, subtitle, summary, full_content, importance, is_secret)
       VALUES ($1, 'npc', $2, 'npc', $3, $4, $5, $6, 20, false)`,
      [
        campaignId,
        npc.id,
        npc.name,
        npc.role || "Local",
        `${npc.name} is known around these parts as the ${(npc.role || "traveler").toLowerCase()}.`,
        JSON.stringify({ role: npc.role, known_for: [npc.role?.toLowerCase() || "local"] }),
      ],
    );
  }

  const factions = await client.query(
    `SELECT id, name, description, type
     FROM public.factions
     WHERE campaign_id = $1`,
    [campaignId],
  );

  for (const fac of factions.rows) {
    const existing = await client.query(
      `SELECT 1 FROM public.encyclopedia_entries
       WHERE campaign_id = $1 AND source_type = 'faction' AND source_id = $2`,
      [campaignId, fac.id],
    );
    if (existing.rows.length > 0) continue;

    await client.query(
      `INSERT INTO public.encyclopedia_entries
       (campaign_id, category, source_id, source_type, title, subtitle, summary, full_content, importance, is_secret)
       VALUES ($1, 'faction', $2, 'faction', $3, $4, $5, $6, 40, false)`,
      [
        campaignId,
        fac.id,
        fac.name,
        fac.type || "Organization",
        fac.description || "A faction operating in the region.",
        JSON.stringify({ type: fac.type, influence: 60 }),
      ],
    );
  }

  const charRes = await client.query(
    "SELECT id FROM public.characters WHERE campaign_id = $1 AND is_alive = true LIMIT 1",
    [campaignId],
  );

  if (charRes.rows.length > 0) {
    const characterId = charRes.rows[0].id;
    const entriesRes = await client.query(
      "SELECT id FROM public.encyclopedia_entries WHERE campaign_id = $1",
      [campaignId],
    );

    for (const entry of entriesRes.rows) {
      await client.query(
        `INSERT INTO public.character_knowledge
         (campaign_id, character_id, entry_id, knowledge_level, discovery_source)
         VALUES ($1, $2, $3, 2, 'exploration')
         ON CONFLICT (character_id, entry_id) DO UPDATE SET
           knowledge_level = GREATEST(character_knowledge.knowledge_level, 2)`,
        [campaignId, characterId, entry.id],
      );
    }
  }

  console.log(`[SoloEngine] Encyclopedia seeded successfully`);
}

export async function executeEnemyTurn(
  client: PoolClient | Pool,
  encounter: CombatEncounter,
): Promise<CombatEncounter> {
  const activeParticipant = encounter.turn_order[encounter.current_turn_index];
  if (!activeParticipant || activeParticipant.type !== "enemy") {
    return encounter;
  }

  const alivePlayers = encounter.participants.filter(
    (p) => p.type === "player" && p.hp_current > 0,
  );

  if (alivePlayers.length === 0) return encounter;

  const target = alivePlayers.sort((a, b) => a.hp_current - b.hp_current)[0];

  try {
    const dmUserId = await getDmUserId(client, encounter.campaign_id);
    if (dmUserId) {
      return await processCombatAction(encounter.campaign_id, dmUserId, "attack", target.id);
    }
  } catch (err) {
    console.error("[SoloEngine] Enemy turn execution failed:", err);
  }

  return encounter;
}

async function getDmUserId(client: PoolClient | Pool, campaignId: string): Promise<string | null> {
  const res = await client.query(
    "SELECT user_id FROM public.campaign_members WHERE campaign_id = $1 AND role = 'dm' LIMIT 1",
    [campaignId],
  );
  return res.rows[0]?.user_id || null;
}

async function ensureSoloGameState(campaignId: string, userId: string): Promise<SoloGameState> {
  const existing = activeSoloGames.get(campaignId);
  if (existing) {
    if (existing.userId !== userId) {
      throw new Error("Solo game not found or unauthorized");
    }
    return existing;
  }

  const res = await pool.query(
    `SELECT c.world_state, ch.id AS character_id
     FROM public.campaigns c
     JOIN public.campaign_members cm ON cm.campaign_id = c.id AND cm.user_id = $2
     JOIN public.characters ch ON ch.id = cm.character_id
     WHERE c.id = $1
       AND COALESCE((c.world_state->>'solo_mode')::boolean, false) = true
     LIMIT 1`,
    [campaignId, userId],
  );

  if (res.rows.length === 0) {
    throw new Error("Solo game not found or unauthorized");
  }

  const gameState: SoloGameState = {
    campaignId,
    characterId: res.rows[0].character_id,
    userId,
    phase: "exploration",
    turnCount: 0,
    lastActionAt: new Date(),
    autoSaveInterval: null,
    isActive: true,
  };
  activeSoloGames.set(campaignId, gameState);
  return gameState;
}

export async function initializeSoloCampaign(
  userId: string,
  username: string,
  characterName: string,
  characterClass: string,
  characterRace: string,
): Promise<{ campaignId: string; characterId: string }> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let inviteCode = generateInviteCode();
    let codeCheck = await client.query("SELECT 1 FROM public.campaigns WHERE invite_code = $1", [
      inviteCode,
    ]);
    let attempts = 0;
    while (codeCheck.rows.length > 0 && attempts < 5) {
      inviteCode = generateInviteCode();
      codeCheck = await client.query("SELECT 1 FROM public.campaigns WHERE invite_code = $1", [
        inviteCode,
      ]);
      attempts++;
    }

    const campaignRes = await client.query(
      `INSERT INTO public.campaigns (name, invite_code, owner_id, world_state, world_flags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        `${username}'s Solo Adventure`,
        inviteCode,
        userId,
        JSON.stringify({
          starting_location_id: null,
          discovered_location_ids: [],
          character_locations: {},
          solo_mode: true,
          auto_dm: true,
        }),
        JSON.stringify({ solo_campaign: true }),
      ],
    );
    const campaignId = campaignRes.rows[0].id;

    await client.query(
      "INSERT INTO public.campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')",
      [campaignId, userId],
    );

    const townRes = await client.query(
      `INSERT INTO public.locations (campaign_id, name, type, description, state, lore)
       VALUES ($1, 'Emberfall Village', 'village', $2, $3, $4)
       RETURNING id`,
      [
        campaignId,
        "A lantern-lit frontier village with a busy tavern, a wary watchtower, and muddy roads.",
        JSON.stringify({ discovered: true, solo_start: true }),
        "Founded beside old dwarven mile markers pointing toward ruins in the eastern hills.",
      ],
    );
    const townId = townRes.rows[0].id;

    const wildRes = await client.query(
      `INSERT INTO public.locations (campaign_id, name, type, description, state, lore)
       VALUES ($1, 'Briarwood Wilds', 'wilderness', $2, $3, $4)
       RETURNING id`,
      [
        campaignId,
        "Dense forest where tracks disappear quickly after rain.",
        JSON.stringify({ discovered: false }),
        "Travelers claim old campfires glow here without anyone tending them.",
      ],
    );
    const wildId = wildRes.rows[0].id;

    const dungeonRes = await client.query(
      `INSERT INTO public.locations (campaign_id, name, type, description, state, lore)
       VALUES ($1, 'Ashen Gate Ruins', 'dungeon', $2, $3, $4)
       RETURNING id`,
      [
        campaignId,
        "A collapsed stone archway breathing cold air from below.",
        JSON.stringify({ discovered: false }),
        "Sealed after a mining company vanished three generations ago.",
      ],
    );
    const dungeonId = dungeonRes.rows[0].id;

    await client.query("UPDATE public.locations SET connected_locations = $1::uuid[] WHERE id = $2", [
      [wildId, dungeonId],
      townId,
    ]);
    await client.query("UPDATE public.locations SET connected_locations = $1::uuid[] WHERE id = $2", [
      [townId, dungeonId],
      wildId,
    ]);
    await client.query("UPDATE public.locations SET connected_locations = $1::uuid[] WHERE id = $2", [
      [wildId],
      dungeonId,
    ]);

    const classStats = getSoloStartingStats(characterClass);
    const charRes = await client.query(
      `INSERT INTO public.characters
       (campaign_id, user_id, name, race, class, level, hp_current, hp_max, attributes, skills, gold, xp, is_alive)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6, $7, $8, 50, 0, true)
       RETURNING id`,
      [
        campaignId,
        userId,
        characterName,
        characterRace,
        characterClass,
        classStats.hp,
        JSON.stringify(classStats.attributes),
        JSON.stringify(getDefaultSkills(characterClass)),
      ],
    );
    const characterId = charRes.rows[0].id;

    await client.query("UPDATE public.campaigns SET world_state = $1 WHERE id = $2", [
      JSON.stringify({
        starting_location_id: townId,
        discovered_location_ids: [townId],
        character_locations: { [characterId]: townId },
        current_location_id: townId,
        solo_mode: true,
        auto_dm: true,
      }),
      campaignId,
    ]);

    await client.query(
      "UPDATE public.campaign_members SET character_id = $1 WHERE campaign_id = $2 AND user_id = $3",
      [characterId, campaignId, userId],
    );

    await client.query(
      `INSERT INTO public.npcs (campaign_id, name, role, location_id, is_alive, relationship_map, base_stats, agenda_state)
       VALUES
       ($1, 'Eldric Ironhammer', 'Blacksmith', $2, true, '{}', $3, '{}'),
       ($1, 'Mira Shadowstep', 'Scout', $4, true, '{}', $5, '{}'),
       ($1, 'Brother Thorne', 'Cleric', $2, true, '{}', $6, '{}')`,
      [
        campaignId,
        townId,
        JSON.stringify({ str: 18, cha: 12, fear: 30, ambition: 60 }),
        wildId,
        JSON.stringify({ dex: 16, int: 14, fear: 40, ambition: 70 }),
        JSON.stringify({ wis: 16, con: 14, fear: 20, ambition: 40 }),
      ],
    );

    await client.query(
      `INSERT INTO public.factions
       (campaign_id, name, type, personality, disposition, power_level, description, is_hidden, military, wealth, influence, stability, pressure, pressure_cap, objectives, victory_condition, is_victorious, collapsed)
       VALUES ($1, 'Blackwater Syndicate', 'criminal', 'expansionist', 'hostile', 15, 'A criminal organization operating in the shadows.', false, 15, 30, 10, 80, 0, 1000, '[]'::jsonb, '{}'::jsonb, false, false)`,
      [campaignId],
    );

    await seedEncyclopediaForSolo(client, campaignId);

    await client.query(
      `INSERT INTO public.quests (campaign_id, type, title, description, objectives, rewards, status)
       VALUES ($1, 'main', $2, $3, $4, $5, 'active')`,
      [
        campaignId,
        "The Road to Adventure",
        "Explore the world beyond Emberfall Village. Discover what lies in the Briarwood Wilds and the Ashen Gate Ruins.",
        JSON.stringify([
          {
            text: "Visit Briarwood Wilds",
            completed: false,
            condition: { type: "location_visit", location_id: wildId },
          },
          {
            text: "Discover Ashen Gate Ruins",
            completed: false,
            condition: { type: "location_visit", location_id: dungeonId },
          },
        ]),
        JSON.stringify({ gold: 100, xp: 200 }),
      ],
    );

    await client.query(
      `INSERT INTO public.event_log (campaign_id, type, payload, ai_narration)
       VALUES ($1, 'exploration', $2, $3)`,
      [
        campaignId,
        JSON.stringify({
          action_type: "campaign_start",
          text: `${characterName} begins their adventure in Emberfall Village.`,
          actor_name: characterName,
        }),
        getOfflineNarration("exploration"),
      ],
    );

    await client.query("COMMIT");

    const gameState: SoloGameState = {
      campaignId,
      characterId,
      userId,
      phase: "exploration",
      turnCount: 0,
      lastActionAt: new Date(),
      autoSaveInterval: null,
      isActive: true,
    };
    activeSoloGames.set(campaignId, gameState);

    console.log(`[SoloEngine] Solo campaign initialized: ${campaignId}`);
    return { campaignId, characterId };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[SoloEngine] Failed to initialize solo campaign:", err);
    throw err;
  } finally {
    client.release();
  }
}

function getSoloStartingStats(className: string): { attributes: Record<string, number>; hp: number } {
  const stats: Record<string, { attributes: Record<string, number>; hp: number }> = {
    Fighter: { attributes: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, hp: 12 },
    Wizard: { attributes: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 }, hp: 8 },
    Rogue: { attributes: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 14 }, hp: 10 },
    Cleric: { attributes: { str: 14, dex: 8, con: 14, int: 10, wis: 16, cha: 12 }, hp: 10 },
    Barbarian: { attributes: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 8 }, hp: 14 },
    Ranger: { attributes: { str: 12, dex: 16, con: 12, int: 10, wis: 14, cha: 8 }, hp: 11 },
  };

  return stats[className] || stats.Fighter;
}

function getDefaultSkills(className: string): Record<string, number> {
  const skills: Record<string, Record<string, number>> = {
    Fighter: { athletics: 2, intimidation: 1, perception: 1 },
    Wizard: { arcana: 2, investigation: 2, history: 1 },
    Rogue: { stealth: 2, sleight_of_hand: 2, acrobatics: 1 },
    Cleric: { medicine: 2, insight: 2, religion: 1 },
    Barbarian: { athletics: 2, survival: 2, intimidation: 1 },
    Ranger: { survival: 2, perception: 2, nature: 1 },
  };

  return skills[className] || { perception: 1 };
}

export async function processSoloAction(
  campaignId: string,
  userId: string,
  action: { type: string; text?: string; targetLocationId?: string; targetId?: string },
): Promise<any> {
  const gameState = await ensureSoloGameState(campaignId, userId);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const charRes = await client.query(
      "SELECT * FROM public.characters WHERE id = $1 AND is_alive = true",
      [gameState.characterId],
    );

    if (charRes.rows.length === 0) {
      throw new Error("Character not found or deceased");
    }

    const character = charRes.rows[0];
    let result: any = { success: true, narration: "" };

    switch (action.type) {
      case "move":
        result = await handleSoloMovement(client, gameState, action.targetLocationId);
        break;
      case "explore":
        result = await handleSoloExploration(client, gameState, action.text);
        break;
      case "combat":
        result = await handleSoloCombatInit(client, gameState);
        break;
      case "rest":
        result = await handleSoloRest(client, gameState);
        break;
      case "interact":
        result = await handleSoloInteraction(client, gameState, action.targetId, action.text);
        break;
      default:
        result = {
          success: true,
          narration: getOfflineNarration("default"),
          event: null,
        };
    }

    if (!result.narration) {
      result.narration = dmService.isEnabled()
        ? await generateAiNarration(gameState, action)
        : getOfflineNarration(action.type);
    }

    const eventRes = await client.query(
      `INSERT INTO public.event_log (campaign_id, type, actor_id, payload, ai_narration)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        campaignId,
        action.type === "combat" ? "combat" : "exploration",
        gameState.characterId,
        JSON.stringify({
          action_type: action.type,
          text: action.text || `${character.name} performs ${action.type}`,
          actor_name: character.name,
          result,
        }),
        result.narration,
      ],
    );

    await client.query("COMMIT");

    gameState.turnCount++;
    gameState.lastActionAt = new Date();

    try {
      RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
        id: eventRes.rows[0].id,
        type: action.type === "combat" ? "combat" : "exploration",
        actor_name: character.name,
        payload: result,
        timestamp: eventRes.rows[0].created_at,
        ai_narration: result.narration,
      });
    } catch {
      console.log("[SoloEngine] WebSocket broadcast skipped (solo mode)");
    }

    return {
      ...result,
      event_id: eventRes.rows[0].id,
      timestamp: eventRes.rows[0].created_at,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[SoloEngine] Action processing failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

async function handleSoloMovement(
  client: PoolClient,
  gameState: SoloGameState,
  targetLocationId?: string,
): Promise<any> {
  if (!targetLocationId) {
    return { success: false, narration: "No destination specified." };
  }

  const campaignRes = await client.query(
    "SELECT world_state FROM public.campaigns WHERE id = $1",
    [gameState.campaignId],
  );
  const worldState = parseJsonField<Record<string, any>>(campaignRes.rows[0]?.world_state, {});
  const currentLocId = worldState.character_locations?.[gameState.characterId];

  const locRes = await client.query(
    "SELECT name, connected_locations FROM public.locations WHERE id = $1",
    [currentLocId],
  );

  const connected = locRes.rows[0]?.connected_locations || [];
  const connectedIds = Array.isArray(connected) ? connected.map(String) : [];
  if (!connectedIds.includes(String(targetLocationId))) {
    return { success: false, narration: "That location is not accessible from here." };
  }

  const newLocations = { ...worldState.character_locations, [gameState.characterId]: targetLocationId };
  const discovered = [...(worldState.discovered_location_ids || []), targetLocationId];

  await client.query("UPDATE public.campaigns SET world_state = $1 WHERE id = $2", [
    JSON.stringify({
      ...worldState,
      character_locations: newLocations,
      discovered_location_ids: [...new Set(discovered)],
      current_location_id: targetLocationId,
    }),
    gameState.campaignId,
  ]);

  const targetRes = await client.query(
    "SELECT name, description, type FROM public.locations WHERE id = $1",
    [targetLocationId],
  );
  const targetLoc = targetRes.rows[0];

  const encounterChance = targetLoc?.type === "wilderness" ? 0.3 : 0.1;
  const hasEncounter = Math.random() < encounterChance;

  let narration = `You travel to ${targetLoc?.name || "the new location"}. ${targetLoc?.description || ""}`;
  if (hasEncounter) {
    narration += " As you arrive, you sense danger lurking nearby...";
  }

  return {
    success: true,
    narration,
    location: targetLoc,
    encounterPending: hasEncounter,
  };
}

async function handleSoloExploration(
  client: PoolClient,
  gameState: SoloGameState,
  _text?: string,
): Promise<any> {
  const campaignRes = await client.query(
    "SELECT world_state FROM public.campaigns WHERE id = $1",
    [gameState.campaignId],
  );
  const worldState = parseJsonField<Record<string, any>>(campaignRes.rows[0]?.world_state, {});
  const currentLocId = worldState.current_location_id;

  const locRes = await client.query(
    `SELECT l.*,
      COALESCE(json_agg(n.*) FILTER (WHERE n.id IS NOT NULL), '[]') AS npcs
     FROM public.locations l
     LEFT JOIN public.npcs n ON n.location_id = l.id AND n.is_alive = true
     WHERE l.id = $1
     GROUP BY l.id`,
    [currentLocId],
  );

  const location = locRes.rows[0];
  const charRes = await client.query(
    "SELECT attributes, skills FROM public.characters WHERE id = $1",
    [gameState.characterId],
  );
  const char = charRes.rows[0];
  const attributes = parseJsonField<Record<string, number>>(char.attributes, {});
  const skills = parseJsonField<Record<string, number>>(char.skills, {});
  const wisMod = Math.floor(((attributes.wis || 10) - 10) / 2);
  const skillBonus = skills.perception || 0;
  const roll = rollDice("d20", wisMod + skillBonus);
  const success = roll.final >= 12;

  let narration = "";
  let discovery = null;

  if (success) {
    narration = `You survey your surroundings carefully. ${location?.description || ""} You notice details others might miss.`;
    if (Math.random() < 0.3 && location?.lore) {
      discovery = location.lore;
      narration += ` You uncover a clue: ${discovery}`;
    }
  } else {
    narration = `You look around, but find nothing of particular interest in ${location?.name || "this place"}.`;
  }

  const npcs = Array.isArray(location?.npcs) ? location.npcs : [];
  if (npcs.length > 0) {
    const npcNames = npcs.map((n: { name: string }) => n.name).join(", ");
    narration += ` Present here: ${npcNames}.`;
  }

  return {
    success,
    narration,
    roll: roll.raw,
    total: roll.final,
    discovery,
    location: { name: location?.name, description: location?.description },
  };
}

async function handleSoloCombatInit(
  client: PoolClient,
  gameState: SoloGameState,
): Promise<any> {
  const campaignRes = await client.query(
    "SELECT world_state FROM public.campaigns WHERE id = $1",
    [gameState.campaignId],
  );
  const worldState = parseJsonField<Record<string, any>>(campaignRes.rows[0]?.world_state, {});
  const currentLocId = worldState.current_location_id;

  const locRes = await client.query(
    "SELECT type, name FROM public.locations WHERE id = $1",
    [currentLocId],
  );
  const location = locRes.rows[0];

  let monsterId = "goblin";
  let count = 1;

  if (location?.type === "dungeon") {
    monsterId = Math.random() < 0.5 ? "skeleton" : "goblin";
    count = Math.floor(Math.random() * 2) + 1;
  } else if (location?.type === "wilderness") {
    monsterId = "goblin";
    count = Math.floor(Math.random() * 2) + 1;
  }

  try {
    const encounter = await startCombat(gameState.campaignId, [{ id: monsterId, count }]);
    gameState.phase = "combat";

    return {
      success: true,
      narration: getOfflineNarration("combat_start"),
      encounter,
      combatStarted: true,
    };
  } catch (err) {
    console.error("[SoloEngine] Combat init failed:", err);
    return {
      success: false,
      narration: "You prepare for combat, but the enemy has fled.",
      combatStarted: false,
    };
  }
}

async function handleSoloRest(
  client: PoolClient,
  gameState: SoloGameState,
): Promise<any> {
  const charRes = await client.query(
    "SELECT hp_max, hp_current FROM public.characters WHERE id = $1",
    [gameState.characterId],
  );
  const char = charRes.rows[0];

  const healRoll = rollDice("d8", 1);
  const newHp = Math.min(char.hp_max, char.hp_current + healRoll.final);

  await client.query("UPDATE public.characters SET hp_current = $1 WHERE id = $2", [
    newHp,
    gameState.characterId,
  ]);

  await runWorldHeartbeat(client, gameState.campaignId, true);
  gameState.phase = "rest";

  return {
    success: true,
    narration: getOfflineNarration("rest"),
    healed: newHp - char.hp_current,
    hpCurrent: newHp,
    hpMax: char.hp_max,
  };
}

async function handleSoloInteraction(
  client: PoolClient,
  gameState: SoloGameState,
  npcId?: string,
  _text?: string,
): Promise<any> {
  if (!npcId) {
    return { success: false, narration: "No one to interact with." };
  }

  const npcRes = await client.query(
    "SELECT * FROM public.npcs WHERE id = $1 AND is_alive = true",
    [npcId],
  );

  if (npcRes.rows.length === 0) {
    return { success: false, narration: "That person is not here." };
  }

  const npc = npcRes.rows[0];
  const currentMap = parseJsonField<Record<string, number>>(npc.relationship_map, {});
  const currentRel = currentMap[gameState.characterId] || 0;
  const newRel = Math.min(100, currentRel + 5);

  await client.query("UPDATE public.npcs SET relationship_map = $1 WHERE id = $2", [
    JSON.stringify({ ...currentMap, [gameState.characterId]: newRel }),
    npcId,
  ]);

  let response = "";
  switch (npc.role) {
    case "Blacksmith":
      response = "Need your blade sharpened? I've got whetstones and tales to share.";
      break;
    case "Scout":
      response = "The wilds have been restless. Goblins near the old ruins, I'd wager.";
      break;
    case "Cleric":
      response = "The gods smile upon the brave. Do you seek healing or guidance?";
      break;
    default:
      response = "Greetings, traveler. What brings you to these parts?";
  }

  return {
    success: true,
    narration: `${npc.name} regards you with ${newRel > 20 ? "warmth" : "caution"}. "${response}"`,
    relationship: newRel,
    npc: { name: npc.name, role: npc.role },
  };
}

async function generateAiNarration(gameState: SoloGameState, action: any): Promise<string> {
  if (!dmService.isEnabled()) {
    return getOfflineNarration(action.type);
  }

  try {
    await buildCampaignSnapshot(pool, gameState.campaignId);
    return getOfflineNarration(action.type);
  } catch {
    return getOfflineNarration(action.type);
  }
}

export async function resolveSoloCombatRound(campaignId: string): Promise<any> {
  const gameState = activeSoloGames.get(campaignId);
  if (!gameState) return null;

  const client = await pool.connect();

  try {
    const encounter = await getActiveEncounter(client, campaignId);
    if (!encounter) return null;

    const activeParticipant = encounter.turn_order[encounter.current_turn_index];
    if (activeParticipant?.type === "enemy") {
      return await executeEnemyTurn(client, encounter);
    }

    return encounter;
  } finally {
    client.release();
  }
}

export function getSoloGameStatus(campaignId: string): SoloGameState | null {
  return activeSoloGames.get(campaignId) || null;
}

export function endSoloGame(campaignId: string): boolean {
  const game = activeSoloGames.get(campaignId);
  if (game?.autoSaveInterval) {
    clearInterval(game.autoSaveInterval);
  }
  activeSoloGames.delete(campaignId);
  return true;
}

export function listActiveSoloGames(): Array<{ campaignId: string; phase: SoloPhase; turnCount: number }> {
  return Array.from(activeSoloGames.entries()).map(([id, state]) => ({
    campaignId: id,
    phase: state.phase,
    turnCount: state.turnCount,
  }));
}
