/**
 * actionProcessor.ts
 *
 * Processes player actions with proper D&D 5e mechanics:
 * - Skill checks use ability modifiers + proficiency + DC
 * - Free-form actions are classified by AI/intent parser
 * - Movement triggers perception checks for encounters
 * - All dice rolls go through diceEngine (canonical)
 */

import { Pool, PoolClient } from "pg";
import { ServerMessageMap } from "@dnd/shared";
import {
  resolveSkillCheck,
  parseSkillFromText,
  determineDCFromText,
  getAbilityModifier,
  getProficiencyBonus,
  broadcastDiceRoll,
  rollDie,
  d20,
  resolveAttackRoll,
  resolveDamageRoll,
} from "./diceEngine";
import { dmService } from "../ai/dmService";
import { buildCampaignSnapshot, getCampaignLocationId, getLocationContext } from "../ai/contextBuilder";
import { buildFreeActionPrompt, buildSystemPrompt } from "../ai/promptTemplates";
import { RoomManager } from "../websocket/roomManager";
import { startCombat, getActiveEncounter } from "./combatEngine";

// ============================================================
// TYPES
// ============================================================

type ActionType = "exploration" | "skill_check" | "npc_interaction" | "combat" | "rest" | "movement" | "other";

export interface ActionParticipant {
  userId: string;
  username: string;
  campaignId: string;
  characterId?: string;
}

export interface ActionInput {
  type: ActionType;
  text: string;
  target_location_id?: string;
}

export interface ProcessedAction {
  event: ServerMessageMap["GAME_EVENT"];
  worldUpdate?: ServerMessageMap["WORLD_UPDATE"];
  narration?: string;
  combatStarted?: boolean;
  skillCheck?: Record<string, unknown>;
}

const VALID_ACTION_TYPES = new Set<ActionType>([
  "exploration", "skill_check", "npc_interaction", "combat", "rest", "movement", "other"
]);

interface CampaignWorldState {
  starting_location_id?: string;
  discovered_location_ids?: string[];
  character_locations?: Record<string, string>;
  current_location_id?: string;
}

// ============================================================
// SKILL KEYWORD → ABILITY MAP (D&D 5e standard)
// ============================================================

const SKILL_ABILITY_MAP: Record<string, keyof AbilityScores> = {
  acrobatics: "dexterity",
  animalHandling: "wisdom",
  arcana: "intelligence",
  athletics: "strength",
  deception: "charisma",
  history: "intelligence",
  insight: "wisdom",
  intimidation: "charisma",
  investigation: "intelligence",
  medicine: "wisdom",
  nature: "intelligence",
  perception: "wisdom",
  performance: "charisma",
  persuasion: "charisma",
  religion: "intelligence",
  sleightOfHand: "dexterity",
  stealth: "dexterity",
  survival: "wisdom",
};

interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

function resolveAbilityScores(char: {
  ability_scores?: AbilityScores;
  attributes?: Record<string, number>;
}): AbilityScores {
  if (char.ability_scores) return char.ability_scores;
  const attrs = char.attributes || {};
  return {
    strength: attrs.str ?? attrs.strength ?? 10,
    dexterity: attrs.dex ?? attrs.dexterity ?? 10,
    constitution: attrs.con ?? attrs.constitution ?? 10,
    intelligence: attrs.int ?? attrs.intelligence ?? 10,
    wisdom: attrs.wis ?? attrs.wisdom ?? 10,
    charisma: attrs.cha ?? attrs.charisma ?? 10,
  };
}

function resolveProficiencies(char: {
  proficiencies?: string[];
  skills?: Record<string, number>;
}): string[] {
  if (char.proficiencies?.length) return char.proficiencies;
  if (!char.skills) return [];
  return Object.entries(char.skills)
    .filter(([, value]) => Number(value) > 0)
    .map(([key]) => key);
}

// ============================================================
// INTENT CLASSIFICATION (for free-form "other" actions)
// ============================================================

interface ClassifiedIntent {
  intent: "attack" | "skill_check" | "movement" | "social" | "investigation" | "rest" | "item_use" | "spell_cast" | "other";
  confidence: number;
  suggestedSkill?: string;
  targetType?: string;
}

function classifyIntentLocal(text: string): ClassifiedIntent {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  // Keyword scoring
  const scores: Record<string, number> = {
    attack: 0,
    skill_check: 0,
    movement: 0,
    social: 0,
    investigation: 0,
    rest: 0,
    item_use: 0,
    spell_cast: 0,
    other: 1,
  };

  // Attack keywords
  const attackWords = ["attack", "fight", "strike", "hit", "stab", "shoot", "cast", "fire", "swing", "slash", "punch", "kick", "kill", "defeat", "charge", "rush"];
  attackWords.forEach((w) => { if (lower.includes(w)) scores.attack += 2; });

  // Movement keywords
  const moveWords = ["go", "move", "walk", "run", "travel", "head", "approach", "enter", "leave", "exit", "flee", "retreat", "advance", "sneak", "creep", "climb", "jump", "swim"];
  moveWords.forEach((w) => { if (lower.includes(w)) scores.movement += 2; });

  // Social keywords
  const socialWords = ["talk", "speak", "ask", "persuade", "convince", "charm", "intimidate", "threaten", "negotiate", "bribe", "seduce", "compliment", "insult", "demand", "beg", "plead"];
  socialWords.forEach((w) => { if (lower.includes(w)) scores.social += 2; });

  // Investigation keywords
  const invWords = ["search", "look", "investigate", "examine", "inspect", "check", "scout", "spot", "find", "seek", "discover", "detect", "sense", "perceive", "listen", "watch"];
  invWords.forEach((w) => { if (lower.includes(w)) scores.investigation += 2; });

  // Rest keywords
  const restWords = ["rest", "sleep", "camp", "heal", "recover", "sit", "wait", "pause", "break", "meditate", "pray"];
  restWords.forEach((w) => { if (lower.includes(w)) scores.rest += 2; });

  // Item use keywords
  const itemWords = ["use", "drink", "eat", "consume", "equip", "wear", "hold", "wield", "draw", "activate", "throw", "drop", "pick", "grab", "take"];
  itemWords.forEach((w) => { if (lower.includes(w)) scores.item_use += 2; });

  // Spell cast keywords
  const spellWords = ["spell", "magic", "chant", "invoke", "summon", "teleport", "heal", "bless", "curse", "ward", "shield", "fireball", "lightning", "frost", "illusion"];
  spellWords.forEach((w) => { if (lower.includes(w)) scores.spell_cast += 2; });

  // Skill check keywords (general)
  const skillWords = ["try", "attempt", "check", "roll", "test", "perform", "do", "make", "craft", "build", "repair", "pick lock", "disarm", "track", "forage", "survive"];
  skillWords.forEach((w) => { if (lower.includes(w)) scores.skill_check += 1; });

  // Determine winner
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const winner = entries[0];
  const runnerUp = entries[1];

  const confidence = winner[1] > 0 ? Math.min(0.95, 0.5 + (winner[1] - runnerUp[1]) * 0.1) : 0.3;

  // Suggest skill based on keywords
  const suggestedSkill = parseSkillFromText(text);

  return {
    intent: winner[0] as ClassifiedIntent["intent"],
    confidence,
    suggestedSkill,
    targetType: undefined,
  };
}

// ============================================================
// SKILL CHECK PROCESSING (proper D&D 5e)
// ============================================================

async function processSkillCheckAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  // 1. Load character stats
  const charRes = await client.query(
    `SELECT ability_scores, attributes, skills, proficiencies, level, name
     FROM public.characters
     WHERE id = $1`,
    [participant.characterId]
  );

  if (charRes.rows.length === 0) {
    throw new Error("Character not found");
  }

  const char = charRes.rows[0];
  const abilityScores = resolveAbilityScores(char);
  const proficiencies = resolveProficiencies(char);
  const level = char.level || 1;

  // 2. Parse skill from action text
  const skillName = parseSkillFromText(actionText);
  const abilityKey = SKILL_ABILITY_MAP[skillName] || "wisdom";
  const abilityScore = abilityScores[abilityKey];
  const proficient = proficiencies.includes(skillName);

  // 3. Determine DC
  const dc = determineDCFromText(actionText);

  // 4. Resolve skill check
  const result = resolveSkillCheck(abilityScore, level, proficient, dc);

  // 5. Broadcast dice roll
  broadcastDiceRoll(participant.campaignId, {
    dice_type: "d20",
    raw: result.raw,
    modifier: result.totalModifier,
    final: result.final,
    roller_name: characterName,
    context: `${skillName.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())} Check (DC ${dc})`,
    campaign_id: participant.campaignId,
    character_id: participant.characterId,
    roll_breakdown: {
      raw_rolls: result.rawRolls,
      ability_modifier: result.modifier,
      proficiency_bonus: result.proficiencyBonus,
      dc: result.dc,
      success: result.success,
      is_crit: result.isCriticalSuccess,
      is_fumble: result.isCriticalFail,
    },
  });

  // 6. Build payload
  const payload = {
    action_type: "skill_check",
    text: actionText,
    actor_name: characterName,
    skill: skillName,
    ability: abilityKey,
    dc: result.dc,
    raw_roll: result.raw,
    modifier: result.modifier,
    proficiency_bonus: result.proficiencyBonus,
    final_value: result.final,
    success: result.success,
    is_critical_success: result.isCriticalSuccess,
    is_critical_fail: result.isCriticalFail,
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'skill_check', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
    skillCheck: result as unknown as Record<string, unknown>,
  };
}

// ============================================================
// MOVEMENT PROCESSING (with encounter check)
// ============================================================

async function processMovementAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  targetLocationId: string
): Promise<ProcessedAction> {
  const campaignRes = await client.query(
    "SELECT world_state FROM public.campaigns WHERE id = $1 FOR UPDATE",
    [participant.campaignId]
  );

  if (campaignRes.rows.length === 0) {
    throw new Error("Campaign not found");
  }

  const worldState = (campaignRes.rows[0].world_state || {}) as CampaignWorldState;
  const currentLocationId =
    worldState.character_locations?.[participant.characterId || ""] ||
    worldState.starting_location_id;

  if (!currentLocationId) {
    throw new Error("Campaign world has no starting location yet");
  }

  // Fetch locations
  const locationsRes = await client.query(
    `SELECT id, name, connected_locations, type, danger_level, description
     FROM public.locations
     WHERE campaign_id = $1 AND id = ANY($2::uuid[])`,
    [participant.campaignId, [currentLocationId, targetLocationId]]
  );

  const currentLocation = locationsRes.rows.find((loc: { id: string }) => loc.id === currentLocationId);
  const targetLocation = locationsRes.rows.find((loc: { id: string }) => loc.id === targetLocationId);

  if (!currentLocation || !targetLocation) {
    throw new Error("Location not found in this campaign");
  }

  if (currentLocation.id !== targetLocation.id && !currentLocation.connected_locations?.includes(targetLocation.id)) {
    throw new Error(`${targetLocation.name} is not connected to your current location`);
  }

  // Update world state
  const characterLocations = {
    ...(worldState.character_locations || {}),
    [participant.characterId as string]: targetLocation.id,
  };
  const discoveredLocationIds = Array.from(
    new Set([...(worldState.discovered_location_ids || []), currentLocation.id, targetLocation.id])
  );
  const nextWorldState: CampaignWorldState = {
    ...worldState,
    starting_location_id: worldState.starting_location_id || currentLocation.id,
    discovered_location_ids: discoveredLocationIds,
    character_locations: characterLocations,
    current_location_id: targetLocation.id,
  };

  await client.query("UPDATE public.campaigns SET world_state = $1 WHERE id = $2", [
    JSON.stringify(nextWorldState),
    participant.campaignId,
  ]);
  await client.query(
    "UPDATE public.locations SET state = state || $1::jsonb WHERE id = $2",
    [JSON.stringify({ discovered: true }), targetLocation.id]
  );

  // Passive Perception check for encounters (d20 + WIS mod, DC 12)
  const charRes = await client.query(
    "SELECT ability_scores, attributes FROM public.characters WHERE id = $1",
    [participant.characterId],
  );
  const abilityScores = resolveAbilityScores(charRes.rows[0] || {});
  const wisMod = getAbilityModifier(abilityScores.wisdom || 10);
  const perceptionRoll = d20() + wisMod;
  const encounterTriggered = perceptionRoll >= 12 && shouldTriggerEncounter(targetLocation.danger_level || "medium");

  let encounterNote = "";
  if (encounterTriggered) {
    encounterNote = ` As you travel, your senses prickle. Something watches from the shadows...`;
    // Queue combat encounter seed for DM to resolve (or auto-start in solo mode)
  }

  const payload = {
    action_type: "movement",
    text: `${characterName} travels from ${currentLocation.name} to ${targetLocation.name}.${encounterNote}`,
    actor_name: characterName,
    from_location_id: currentLocation.id,
    from_location_name: currentLocation.name,
    to_location_id: targetLocation.id,
    to_location_name: targetLocation.name,
    perception_roll: perceptionRoll,
    encounter_triggered: encounterTriggered,
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
    worldUpdate: {
      location_id: targetLocation.id,
      actor_id: participant.characterId,
      actor_name: characterName,
      from_location: currentLocation.name,
      to_location: targetLocation.name,
      changes: {
        current_location_id: targetLocation.id,
        current_location_name: targetLocation.name,
        character_id: participant.characterId,
        character_locations: characterLocations,
        discovered_location_ids: discoveredLocationIds,
      },
    },
    combatStarted: encounterTriggered,
  };
}

function shouldTriggerEncounter(dangerLevel: string): boolean {
  const roll = d20();
  switch (dangerLevel) {
    case "safe": return false;
    case "low": return roll >= 18;
    case "medium": return roll >= 14;
    case "high": return roll >= 10;
    case "deadly": return roll >= 6;
    default: return roll >= 14;
  }
}

// ============================================================
// FREE-FORM "OTHER" ACTION PROCESSING
// ============================================================

async function processFreeFormAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  // 1. Classify intent
  const intent = classifyIntentLocal(actionText);

  // 2. Route based on intent
  switch (intent.intent) {
    case "attack":
      return await processCombatIntent(client, participant, characterName, actionText);
    case "skill_check":
    case "investigation":
      return await processSkillCheckAction(client, participant, characterName, actionText);
    case "movement":
      // Try to extract location from text, or just log as exploration
      return await processExplorationAction(client, participant, characterName, actionText);
    case "social":
      return await processSocialAction(client, participant, characterName, actionText);
    case "rest":
      return await processRestAction(client, participant, characterName, actionText);
    case "item_use":
      return await processItemUseAction(client, participant, characterName, actionText);
    case "spell_cast":
      return await processSpellCastAction(client, participant, characterName, actionText);
    default:
      return await processGenericAction(client, participant, characterName, actionText, intent);
  }
}

async function processCombatIntent(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  // Check if already in combat
  const existing = await getActiveEncounter(client, participant.campaignId);
  if (existing) {
    return {
      event: {
        id: "combat-active",
        type: "system",
        actor_name: characterName,
        payload: { text: "Combat is already in progress! Use combat actions.", action_type: "combat_warning" },
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Log intent
  const payload = {
    action_type: "combat_intent",
    text: actionText,
    actor_name: characterName,
    classified_intent: "attack",
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'combat', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "combat",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
    narration: `${characterName} readies for combat! The DM will resolve the encounter.`,
  };
}

async function processExplorationAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  const payload = {
    action_type: "exploration",
    text: actionText,
    actor_name: characterName,
    classified_intent: "movement",
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
  };
}

async function processSocialAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  // Auto-skill check for social actions (Persuasion/Deception/Intimidation)
  return await processSkillCheckAction(client, participant, characterName, actionText);
}

async function processRestAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  const charRes = await client.query(
    "SELECT hp_max, hp_current, level FROM public.characters WHERE id = $1",
    [participant.characterId]
  );
  const char = charRes.rows[0];
  if (!char) throw new Error("Character not found");

  const isLongRest = actionText.toLowerCase().includes("long rest") || actionText.toLowerCase().includes("sleep");
  let healed = 0;
  let newHp = char.hp_current;

  if (isLongRest) {
    // Long rest: restore all HP
    newHp = char.hp_max;
    healed = char.hp_max - char.hp_current;
  } else {
    // Short rest: roll hit dice (1d8 + CON mod per level, but simplified: 1d8 + CON mod)
    const conMod = 0; // Would need to fetch CON score
    const hitDieRoll = rollDie(8) + conMod;
    newHp = Math.min(char.hp_max, char.hp_current + hitDieRoll);
    healed = newHp - char.hp_current;
  }

  await client.query(
    "UPDATE public.characters SET hp_current = $1 WHERE id = $2",
    [newHp, participant.characterId]
  );

  const payload = {
    action_type: isLongRest ? "long_rest" : "short_rest",
    text: actionText,
    actor_name: characterName,
    healed,
    hp_current: newHp,
    hp_max: char.hp_max,
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
    narration: `${characterName} takes a ${isLongRest ? "long rest" : "short rest"}, recovering ${healed} hit points.`,
  };
}

async function processItemUseAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  // Simplified: log as item use, DM narrates
  const payload = {
    action_type: "item_use",
    text: actionText,
    actor_name: characterName,
    classified_intent: "item_use",
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
  };
}

async function processSpellCastAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  const payload = {
    action_type: "spell_cast",
    text: actionText,
    actor_name: characterName,
    classified_intent: "spell_cast",
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
  };
}

async function processGenericAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string,
  intent: ClassifiedIntent
): Promise<ProcessedAction> {
  const payload = {
    action_type: "other",
    text: actionText,
    actor_name: characterName,
    classified_intent: intent.intent,
    confidence: intent.confidence,
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  // Enqueue DM narration for free-form actions
  if (dmService.isEnabled()) {
    try {
      const snapshot = await buildCampaignSnapshot(client, participant.campaignId);
      const campaignMeta = snapshot.meta;
      const systemPrompt = campaignMeta ? buildSystemPrompt(campaignMeta) : undefined;

      dmService.enqueueAction(client as unknown as Pool, logRes.rows[0].id, participant.campaignId, {
        campaignId: participant.campaignId,
        party: snapshot.party,
        location: snapshot.location || { name: "unknown", description: "" },
        npcs: snapshot.npcs,
        quests: snapshot.quests,
        recentEvents: snapshot.recentEvents,
        actorName: characterName,
        actionDescription: actionText,
        serverResult: `Classified as ${intent.intent} (confidence: ${Math.round(intent.confidence * 100)}%)`,
      });
    } catch (err: unknown) {
      console.error("[actionProcessor] DM narration enqueue failed:", err instanceof Error ? err.message : String(err));
    }
  }

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: characterName,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
  };
}

// ============================================================
// MAIN PUBLIC API
// ============================================================

export async function processPlayerAction(
  pool: Pool,
  participant: ActionParticipant,
  input: ActionInput
): Promise<ProcessedAction> {
  const text = input.text?.trim();
  const actionType = VALID_ACTION_TYPES.has(input.type) ? input.type : "other";

  if (!text) {
    throw new Error("Action text is required");
  }

  if (!participant.characterId) {
    throw new Error("Create or select a character before submitting actions");
  }

  const memberCheck = await pool.query(
    `SELECT cm.character_id, c.name AS character_name
     FROM public.campaign_members cm
     LEFT JOIN public.characters c ON c.id = cm.character_id
     WHERE cm.campaign_id = $1 AND cm.user_id = $2`,
    [participant.campaignId, participant.userId]
  );

  if (memberCheck.rows.length === 0) {
    throw new Error("You are not a member of this campaign");
  }

  if (memberCheck.rows[0].character_id !== participant.characterId) {
    throw new Error("Your active character is not linked to this campaign session");
  }

  const characterName = memberCheck.rows[0].character_name || participant.username;

  // Route based on type
  if (input.target_location_id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await processMovementAction(client, participant, characterName, input.target_location_id);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (actionType === "skill_check") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await processSkillCheckAction(client, participant, characterName, text);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (actionType === "other") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await processFreeFormAction(client, participant, characterName, text);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Default: generic exploration action
  const payload = {
    action_type: actionType,
    text,
    actor_name: characterName,
  };

  const logRes = await pool.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  return {
    event: {
      id: logRes.rows[0].id,
      type: "exploration",
      actor_name: payload.actor_name,
      payload,
      timestamp: logRes.rows[0].created_at,
    },
  };
}
