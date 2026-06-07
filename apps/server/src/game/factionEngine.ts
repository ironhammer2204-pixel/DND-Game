import { Pool, PoolClient } from "pg";
import {
  Faction,
  FactionAction,
  FactionActionType,
  FactionRelation,
  FactionTerritory,
  PlayerFactionReputation,
  ReputationTier,
  TreatyType,
} from "@dnd/shared";
import { RoomManager } from "../websocket/roomManager";
import {
  FACTION_ACTIONS_CONFIG,
  PERSONALITY_WEIGHTS,
  VICTORY_CONDITIONS,
} from "./factionConfig";
import {
  createEntryFromSource,
  updateEntryFromEvent,
  recordHistoryEvent,
  computeImportance,
} from "./encyclopediaEngine";

// Helper function to cast postgres rows to Faction
function rowToFaction(row: any): Faction {
  return {
    ...row,
    objectives: typeof row.objectives === "string" ? JSON.parse(row.objectives) : (row.objectives ?? []),
    victory_condition: typeof row.victory_condition === "string" ? JSON.parse(row.victory_condition) : (row.victory_condition ?? {}),
  };
}

// Helper to get active campaign cycle
async function getNextCycleNumber(client: PoolClient | Pool, campaignId: string): Promise<number> {
  const res = await client.query(
    "SELECT coalesce(max(cycle_number), 0) + 1 AS next_cycle FROM public.faction_pressure_log WHERE campaign_id = $1",
    [campaignId]
  );
  return parseInt(res.rows[0].next_cycle, 10);
}

// Helper to write event logs
async function logEvent(
  client: PoolClient | Pool,
  campaignId: string,
  type: "combat" | "quest" | "chat" | "exploration" | "system",
  payload: Record<string, any>,
  aiNarration?: string
): Promise<string> {
  const res = await client.query(
    `INSERT INTO public.event_log (campaign_id, type, payload, ai_narration)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [campaignId, type, JSON.stringify(payload), aiNarration ?? null]
  );
  return res.rows[0].id;
}

/**
 * Phase 4.1: Generate Pressure (diminishing returns, treaty bonuses, stability penalties)
 */
export async function generatePressure(client: PoolClient | Pool, campaignId: string, cycleNumber: number): Promise<void> {
  // Fetch active factions
  const factionsRes = await client.query(
    "SELECT * FROM public.factions WHERE campaign_id = $1 AND collapsed = false",
    [campaignId]
  );
  const factions = factionsRes.rows.map(rowToFaction);

  // Fetch relations for treaty calculations
  const relationsRes = await client.query(
    "SELECT * FROM public.faction_relations WHERE campaign_id = $1",
    [campaignId]
  );
  const relations: FactionRelation[] = relationsRes.rows;

  for (const faction of factions) {
    // Base PP calculation: dependent on military, wealth, influence, and territories controlled
    let basePP = 50 + (faction.military + faction.wealth + faction.influence) / 3 + faction.territories * 20;

    // Apply stability penalty
    basePP = basePP * (faction.stability / 100);

    // Apply treaty bonuses: Alliance (+10%), Trade (+10%)
    let treatyMultiplier = 1.0;
    const factionRelations = relations.filter(
      (r) => r.faction_a_id === faction.id || r.faction_b_id === faction.id
    );

    for (const rel of factionRelations) {
      if (rel.treaty_type === "alliance") {
        treatyMultiplier += 0.10;
      } else if (rel.treaty_type === "trade") {
        treatyMultiplier += 0.10;
      }
    }
    basePP *= treatyMultiplier;

    // Diminishing returns formula
    const denominator = 1.0 + faction.pressure / Math.max(1, faction.pressure_cap);
    let generated = Math.round(basePP * (1.0 / denominator));
    generated = Math.max(1, generated); // Ensure at least 1 PP generated

    let newPressure = faction.pressure + generated;
    let decayed = 0;

    // Cap-based decay logic
    if (newPressure > faction.pressure_cap) {
      decayed = Math.round((newPressure - faction.pressure_cap) * 0.5);
      newPressure = newPressure - decayed;
    }

    // Update Faction PP in database
    await client.query(
      "UPDATE public.factions SET pressure = $1 WHERE id = $2",
      [newPressure, faction.id]
    );

    // Insert to pressure log
    await client.query(
      `INSERT INTO public.faction_pressure_log (campaign_id, faction_id, cycle_number, pressure_generated, pressure_spent, pressure_decayed)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [campaignId, faction.id, cycleNumber, generated, decayed]
    );

    // Update local object stats
    faction.pressure = newPressure;
  }
}

/**
 * Phase 4.2: Select Actions (Affordability, cooldowns, personality weights, target selection)
 */
export async function selectActions(client: PoolClient | Pool, campaignId: string): Promise<void> {
  // Fetch active factions
  const factionsRes = await client.query(
    "SELECT * FROM public.factions WHERE campaign_id = $1 AND collapsed = false",
    [campaignId]
  );
  const factions = factionsRes.rows.map(rowToFaction);

  // Fetch campaign locations, npcs, characters, other factions for target selection
  const locationsRes = await client.query("SELECT id, name FROM public.locations WHERE campaign_id = $1", [campaignId]);
  const npcsRes = await client.query("SELECT id, name FROM public.npcs WHERE campaign_id = $1 AND is_alive = true", [campaignId]);
  const charsRes = await client.query("SELECT id, name FROM public.characters WHERE campaign_id = $1 AND is_alive = true", [campaignId]);

  const locationIds = locationsRes.rows.map((r) => r.id);
  const npcIds = npcsRes.rows.map((r) => r.id);
  const charIds = charsRes.rows.map((r) => r.id);

  for (const faction of factions) {
    if (faction.pressure < 50) continue; // Minimum cost for any action is 50

    // Fetch active cooldowns
    const cooldownRes = await client.query(
      `SELECT DISTINCT action_type FROM public.faction_actions
       WHERE faction_id = $1 AND campaign_id = $2 AND cooldown_until > now() AND status != 'vetoed'`,
      [faction.id, campaignId]
    );
    const activeCooldowns = new Set(cooldownRes.rows.map((r) => r.action_type));

    // Check if covert capacity is frozen due to a recent nemesis defection/retirement (last 2 days/cycles)
    const freezeRes = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM public.nemesis_history h
        JOIN public.nemeses n ON n.id = h.nemesis_id
        WHERE n.faction_id = $1 AND h.event_type IN ('nemesis_defection', 'nemesis_retired', 'nemesis_defection_triggered') AND h.occurred_at > now() - interval '2 days'
      ) AS frozen`,
      [faction.id]
    );
    const covertFrozen = freezeRes.rows[0]?.frozen || false;

    // Filter affordable and off-cooldown action types
    const candidates = Object.values(FACTION_ACTIONS_CONFIG).filter((act) => {
      if (act.pressureCost > faction.pressure) return false;
      if (activeCooldowns.has(act.type)) return false;
      if (covertFrozen && act.category === "covert") return false;

      // Check minStats
      if (act.minStats) {
        if (act.minStats.military && faction.military < act.minStats.military) return false;
        if (act.minStats.wealth && faction.wealth < act.minStats.wealth) return false;
        if (act.minStats.influence && faction.influence < act.minStats.influence) return false;
        if (act.minStats.stability && faction.stability < act.minStats.stability) return false;
      }
      return true;
    });

    if (candidates.length === 0) continue;

    // Weighted selection based on personality weights
    const weights = candidates.map((act) => {
      const w = PERSONALITY_WEIGHTS[faction.personality]?.[act.type] ?? 1.0;
      return { act, w };
    });

    const totalWeight = weights.reduce((sum, item) => sum + item.w, 0);
    if (totalWeight <= 0) continue;

    let rng = Math.random() * totalWeight;
    let selectedAct = candidates[0];
    for (const item of weights) {
      rng -= item.w;
      if (rng <= 0) {
        selectedAct = item.act;
        break;
      }
    }

    // Determine target ID and type
    let targetType = selectedAct.targetType;
    let targetId: string | null = null;

    if (targetType === "location" && locationIds.length > 0) {
      targetId = locationIds[Math.floor(Math.random() * locationIds.length)];
    } else if (targetType === "npc" && npcIds.length > 0) {
      targetId = npcIds[Math.floor(Math.random() * npcIds.length)];
    } else if (targetType === "player" && charIds.length > 0) {
      targetId = charIds[Math.floor(Math.random() * charIds.length)];
    } else if (targetType === "faction") {
      // Find a rival or random faction
      const rivals = factions.filter((f) => f.id !== faction.id);
      if (rivals.length > 0) {
        targetId = rivals[Math.floor(Math.random() * rivals.length)].id;
      }
    } else if (targetType === "trade_route" && locationIds.length > 0) {
      targetId = locationIds[Math.floor(Math.random() * locationIds.length)];
    }

    // Fallback target to location if target selection failed
    if (!targetId && locationIds.length > 0) {
      targetType = "location";
      targetId = locationIds[Math.floor(Math.random() * locationIds.length)];
    }

    if (!targetId) continue; // No target available at all

    // Deduct pressure
    const newPressure = faction.pressure - selectedAct.pressureCost;
    await client.query("UPDATE public.factions SET pressure = $1 WHERE id = $2", [newPressure, faction.id]);

    // Calculate cooldown timestamp (e.g. 1 cycle = 1 day)
    const cooldownMs = selectedAct.cooldownCycles * 24 * 60 * 60 * 1000;
    const cooldownUntil = new Date(Date.now() + cooldownMs);

    // Insert action as pending
    const actionInsertRes = await client.query(
      `INSERT INTO public.faction_actions (campaign_id, faction_id, action_type, target_type, target_id, pressure_cost, status, cooldown_until, triggered_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, 'engine')
       RETURNING id`,
      [campaignId, faction.id, selectedAct.type, targetType, targetId, selectedAct.pressureCost, cooldownUntil]
    );
    const actionId = actionInsertRes.rows[0].id;

    // Auto-generate linked side quests for raid, siege, assassination, and fund_trade_route
    const autoQuestTypes = new Set(["raid", "siege", "assassination", "fund_trade_route"]);
    if (autoQuestTypes.has(selectedAct.type)) {
      let targetName = "Target";
      if (targetType === "location" || targetType === "trade_route") {
        const tRes = await client.query("SELECT name FROM public.locations WHERE id = $1", [targetId]);
        targetName = tRes.rows[0]?.name ?? "Location";
      } else if (targetType === "npc") {
        const tRes = await client.query("SELECT name FROM public.npcs WHERE id = $1", [targetId]);
        targetName = tRes.rows[0]?.name ?? "NPC";
      } else if (targetType === "player") {
        const tRes = await client.query("SELECT name FROM public.characters WHERE id = $1", [targetId]);
        targetName = tRes.rows[0]?.name ?? "Character";
      }

      let title = "";
      let description = "";
      if (selectedAct.type === "raid") {
        title = `Stop ${faction.name} Raid on ${targetName}`;
        description = `The ${faction.name} is planning a raid on ${targetName}. Stop them before they plunder the location.`;
      } else if (selectedAct.type === "siege") {
        title = `Relieve ${targetName} Siege by ${faction.name}`;
        description = `The ${faction.name} has laid siege to ${targetName}. Help break the siege.`;
      } else if (selectedAct.type === "assassination") {
        title = `Protect ${targetName} from ${faction.name} Assassin`;
        description = `An assassin of ${faction.name} is targeting ${targetName}. Protect the target from death.`;
      } else if (selectedAct.type === "fund_trade_route") {
        title = `Escort Caravan to ${targetName}`;
        description = `Caravans supported by the ${faction.name} are heading to ${targetName}. Escort the caravan and guarantee safety.`;
      }

      if (title) {
        const objectives = [
          { text: `Address the threat to ${targetName}`, completed: false, action_id: actionId }
        ];
        const rewards = {
          gold: selectedAct.pressureCost * 2,
          xp: selectedAct.pressureCost * 3
        };

        const questInsert = await client.query(
          `INSERT INTO public.quests (campaign_id, type, title, description, objectives, rewards, status)
           VALUES ($1, 'side', $2, $3, $4::jsonb, $5::jsonb, 'active')
           RETURNING id`,
          [campaignId, title, description, JSON.stringify(objectives), JSON.stringify(rewards)]
        );
        const questId = questInsert.rows[0].id;

        // Link quest to action
        await client.query(
          "UPDATE public.faction_actions SET result = jsonb_build_object('linked_quest_id', $1::text) WHERE id = $2",
          [questId, actionId]
        );

        // Broadcast quest
        const questRes = await client.query("SELECT * FROM public.quests WHERE id = $1", [questId]);
        RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: questRes.rows[0] });
      }
    }

    // Update logged spent pressure in log
    await client.query(
      `UPDATE public.faction_pressure_log
       SET pressure_spent = pressure_spent + $1
       WHERE campaign_id = $2 AND faction_id = $3 AND cycle_number = (SELECT max(cycle_number) FROM public.faction_pressure_log WHERE campaign_id = $2 AND faction_id = $3)`,
      [selectedAct.pressureCost, campaignId, faction.id]
    );
  }
}

/**
 * Phase 4.3: Resolve Action (Consequences, narration generator, WS broadcasts, and cascades)
 */
export async function resolveAction(
  client: PoolClient | Pool,
  campaignId: string,
  actionId: string,
  vetoed = false
): Promise<void> {
  const actionRes = await client.query("SELECT * FROM public.faction_actions WHERE id = $1 FOR UPDATE", [actionId]);
  if (actionRes.rows.length === 0) return;
  const action: FactionAction = actionRes.rows[0];

  if (action.status !== "pending") return; // Action already resolved, vetoed, or countered

  if (vetoed) {
    await client.query("UPDATE public.faction_actions SET status = 'vetoed', resolved_at = now() WHERE id = $1", [actionId]);
    return;
  }

  // Fetch executing faction
  const factionRes = await client.query("SELECT * FROM public.factions WHERE id = $1", [action.faction_id]);
  if (factionRes.rows.length === 0) return;
  const faction = rowToFaction(factionRes.rows[0]);

  const actConfig = FACTION_ACTIONS_CONFIG[action.action_type as FactionActionType];
  if (!actConfig) return;

  // Apply self-effects to executing faction
  if (actConfig.selfEffects) {
    const nextMilitary = Math.max(0, faction.military + (actConfig.selfEffects.military ?? 0));
    const nextWealth = Math.max(0, faction.wealth + (actConfig.selfEffects.wealth ?? 0));
    const nextInfluence = Math.max(0, faction.influence + (actConfig.selfEffects.influence ?? 0));
    const nextStability = Math.min(100, Math.max(0, faction.stability + (actConfig.selfEffects.stability ?? 0)));

    await client.query(
      `UPDATE public.factions
       SET military = $1, wealth = $2, influence = $3, stability = $4
       WHERE id = $5`,
      [nextMilitary, nextWealth, nextInfluence, nextStability, faction.id]
    );
  }

  // Apply target-effects
  let targetName = "unknown target";
  const resultDetails: Record<string, any> = {};

  if (action.target_type === "location" || action.target_type === "trade_route") {
    const locRes = await client.query("SELECT name FROM public.locations WHERE id = $1", [action.target_id]);
    targetName = locRes.rows[0]?.name ?? "Location";

    const controlChange = actConfig.targetEffects?.control_percent ?? 10;
    const stabilityChange = actConfig.targetEffects?.stability ?? 0;

    // Upsert territory entry
    const terrRes = await client.query(
      `SELECT * FROM public.faction_territories
       WHERE campaign_id = $1 AND location_id = $2 AND faction_id = $3`,
      [campaignId, action.target_id, faction.id]
    );

    let nextPressureVal = (controlChange ?? 10) * 10;
    if (terrRes.rows.length > 0) {
      nextPressureVal = Math.max(0, terrRes.rows[0].pressure_value + controlChange * 10);
      await client.query(
        `UPDATE public.faction_territories
         SET pressure_value = $1
         WHERE id = $2`,
        [nextPressureVal, terrRes.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO public.faction_territories (campaign_id, location_id, faction_id, pressure_value, control_percent, is_claimed)
         VALUES ($1, $2, $3, $4, 0, false)`,
        [campaignId, action.target_id, faction.id, nextPressureVal]
      );
    }

    resultDetails.pressure_value_change = controlChange * 10;
    resultDetails.location_stability_change = stabilityChange;
  } else if (action.target_type === "npc") {
    const npcRes = await client.query("SELECT name FROM public.npcs WHERE id = $1", [action.target_id]);
    targetName = npcRes.rows[0]?.name ?? "NPC";

    const relChange = actConfig.targetEffects?.relation_score ?? 10;

    // Upsert NPC alignment
    const alignRes = await client.query(
      "SELECT * FROM public.npc_faction_alignment WHERE npc_id = $1 AND faction_id = $2",
      [action.target_id, faction.id]
    );

    if (alignRes.rows.length > 0) {
      const nextScore = Math.min(100, Math.max(-100, alignRes.rows[0].alignment_score + relChange));
      await client.query(
        "UPDATE public.npc_faction_alignment SET alignment_score = $1 WHERE id = $2",
        [nextScore, alignRes.rows[0].id]
      );
    } else {
      await client.query(
        "INSERT INTO public.npc_faction_alignment (npc_id, faction_id, alignment_score, is_agent) VALUES ($1, $2, $3, false)",
        [action.target_id, faction.id, relChange]
      );
    }

    resultDetails.npc_alignment_change = relChange;
  } else if (action.target_type === "faction") {
    const rivalRes = await client.query("SELECT name FROM public.factions WHERE id = $1", [action.target_id]);
    targetName = rivalRes.rows[0]?.name ?? "Faction";

    const relChange = actConfig.targetEffects?.relation_score ?? -20;

    // Upsert faction relation
    const relRes = await client.query(
      `SELECT * FROM public.faction_relations
       WHERE campaign_id = $1 AND ((faction_a_id = $2 AND faction_b_id = $3) OR (faction_a_id = $3 AND faction_b_id = $2))`,
      [campaignId, faction.id, action.target_id]
    );

    if (relRes.rows.length > 0) {
      const nextScore = Math.min(100, Math.max(-100, relRes.rows[0].score + relChange));
      await client.query(
        "UPDATE public.faction_relations SET score = $1 WHERE id = $2",
        [nextScore, relRes.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO public.faction_relations (campaign_id, faction_a_id, faction_b_id, score, treaty_type)
         VALUES ($1, $2, $3, $4, 'none')`,
        [campaignId, faction.id, action.target_id, relChange]
      );
    }

    resultDetails.faction_relation_change = relChange;
  } else if (action.target_type === "player") {
    const charRes = await client.query("SELECT name FROM public.characters WHERE id = $1", [action.target_id]);
    targetName = charRes.rows[0]?.name ?? "Character";

    const relChange = actConfig.targetEffects?.relation_score ?? -5;

    // Upsert player faction reputation
    const repRes = await client.query(
      "SELECT * FROM public.player_faction_reputation WHERE campaign_id = $1 AND character_id = $2 AND faction_id = $3",
      [campaignId, action.target_id, faction.id]
    );

    if (repRes.rows.length > 0) {
      const nextScore = Math.min(100, Math.max(-100, repRes.rows[0].score + relChange));
      await client.query(
        "UPDATE public.player_faction_reputation SET score = $1 WHERE id = $2",
        [nextScore, repRes.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO public.player_faction_reputation (campaign_id, character_id, faction_id, score, tier, bounty_amount)
         VALUES ($1, $2, $3, $4, 'unknown', 0)`,
        [campaignId, action.target_id, faction.id, relChange]
      );
    }

    resultDetails.player_reputation_change = relChange;
  }

  // Generate Narrative text
  let narrative = "";
  switch (action.action_type) {
    case "patrol":
      narrative = `The ${faction.name} has increased patrols around ${targetName}, securing the borders.`;
      break;
    case "raid":
      narrative = `The ${faction.name} launched a brutal raid on ${targetName}, plundering its resources.`;
      break;
    case "siege":
      narrative = `The ${faction.name} has laid siege to ${targetName}, cut off all supply lines, and began bombarding the gates.`;
      break;
    case "invade":
      narrative = `An invading army of the ${faction.name} marched into ${targetName}, claiming it by force.`;
      break;
    case "fortify":
      narrative = `Defenders of the ${faction.name} have fortified ${targetName}, reinforcing its walls and gates.`;
      break;
    case "recruit":
      narrative = `The ${faction.name} has initiated a massive recruitment drive, bolstering their military ranks.`;
      break;
    case "bribe_official":
      narrative = `Gold changed hands in the shadows as the ${faction.name} bribed ${targetName} to look the other way.`;
      break;
    case "fund_trade_route":
      narrative = `The ${faction.name} funded a new trade route to ${targetName}, securing commercial dominion.`;
      break;
    case "create_shortage":
      narrative = `The ${faction.name} manufactured a critical shortage in ${targetName}, driving up prices and sowing civil discontent.`;
      break;
    case "price_manipulation":
      narrative = `Through economic monopoly, the ${faction.name} manipulated local markets in ${targetName} to increase their profits.`;
      break;
    case "corrupt_governor":
      narrative = `Whispers of corruption surround ${targetName}, who has been subverted by the ${faction.name}'s influence.`;
      break;
    case "replace_mayor":
      narrative = `In a sudden political coup, the ${faction.name} replaced the local leadership at ${targetName}.`;
      break;
    case "pass_law":
      narrative = `The ${faction.name} passed a new set of laws at ${targetName} to tax trade and enforce compliance.`;
      break;
    case "assassination":
      narrative = `An assassin from the ${faction.name} struck in the night, eliminating ${targetName}.`;
      break;
    case "blackmail":
      narrative = `The ${faction.name} blackmailed ${targetName}, forcing them to act in their interests.`;
      break;
    case "spy_network":
      narrative = `Spies of the ${faction.name} have established a covert network in ${targetName}, gathering critical intelligence.`;
      break;
    case "sabotage":
      narrative = `Saboteurs from the ${faction.name} infiltrated ${targetName} and destroyed vital stockpiles.`;
      break;
    case "convert_citizens":
      narrative = `Missionaries of the ${faction.name} have converted citizens in ${targetName} to their faith.`;
      break;
    case "build_temple":
      narrative = `A grand temple was constructed by the ${faction.name} in ${targetName}, spreading their influence.`;
      break;
    case "declare_holy_war":
      narrative = `The ${faction.name} has declared a holy war on ${targetName}, rallying their zealots to arms.`;
      break;
    default:
      narrative = `The ${faction.name} executed ${action.action_type} targeting ${targetName}.`;
  }

  // Update action status to resolved
  resultDetails.narrative = narrative;
  await client.query(
    "UPDATE public.faction_actions SET status = 'resolved', result = $1, resolved_at = now() WHERE id = $2",
    [JSON.stringify(resultDetails), actionId]
  );

  // Log to campaign event feed
  await logEvent(client, campaignId, "exploration", {
    action_type: action.action_type,
    text: narrative,
    faction_id: faction.id,
    faction_name: faction.name,
    target_type: action.target_type,
    target_id: action.target_id,
    target_name: targetName,
  });

  // Broadcast resolved action via WS
  RoomManager.broadcastToRoom(campaignId, "FACTION_ACTION_RESOLVED", {
    action: {
      ...action,
      status: "resolved",
      result: resultDetails,
      resolved_at: new Date().toISOString(),
    },
    narrative,
  });

  // Trigger cascade check
  const cascadeTriggerTypes = new Set([
    "raid",
    "siege",
    "invade",
    "assassination",
    "sabotage",
    "declare_holy_war",
  ]);

  if (cascadeTriggerTypes.has(action.action_type)) {
    // Find cascade depth
    let depth = 1;
    let currParentId = action.parent_action_id;
    while (currParentId) {
      const parentRes = await client.query("SELECT parent_action_id FROM public.faction_actions WHERE id = $1", [currParentId]);
      if (parentRes.rows.length === 0) break;
      currParentId = parentRes.rows[0].parent_action_id;
      depth++;
    }

    if (depth < 3) {
      // Find a rival faction (relation score < -20)
      const rivalRelationsRes = await client.query(
        `SELECT * FROM public.faction_relations
         WHERE campaign_id = $1 AND score < -20
           AND (faction_a_id = $2 OR faction_b_id = $2)`,
        [campaignId, faction.id]
      );

      if (rivalRelationsRes.rows.length > 0) {
        const selectedRel = rivalRelationsRes.rows[Math.floor(Math.random() * rivalRelationsRes.rows.length)];
        const rivalFactionId = selectedRel.faction_a_id === faction.id ? selectedRel.faction_b_id : selectedRel.faction_a_id;

        await generateCascadeAction(client, campaignId, action, rivalFactionId, depth);
      }
    }
  }
}

/**
 * Phase 5: Cascade Counter-Action generator (depth-3 limit)
 */
export async function generateCascadeAction(
  client: PoolClient | Pool,
  campaignId: string,
  parentAction: FactionAction,
  rivalFactionId: string,
  _depth: number
): Promise<void> {
  const rivalRes = await client.query("SELECT name, pressure FROM public.factions WHERE id = $1", [rivalFactionId]);
  if (rivalRes.rows.length === 0) return;
  const rival = rivalRes.rows[0];

  // Pick a military or covert counter-action
  const counterActions: FactionActionType[] = ["sabotage", "raid", "assassination", "blackmail", "patrol"];
  const selectedType = counterActions[Math.floor(Math.random() * counterActions.length)];
  const cost = FACTION_ACTIONS_CONFIG[selectedType].pressureCost;

  // Let the cascade action go through even if they don't have enough pressure, but deduct it down to negative or 0
  const nextPressure = Math.max(0, rival.pressure - cost);
  await client.query("UPDATE public.factions SET pressure = $1 WHERE id = $2", [nextPressure, rivalFactionId]);

  // Cooldown is set
  const cooldownMs = FACTION_ACTIONS_CONFIG[selectedType].cooldownCycles * 24 * 60 * 60 * 1000;
  const cooldownUntil = new Date(Date.now() + cooldownMs);

  // Insert cascade action as pending
  await client.query(
    `INSERT INTO public.faction_actions (campaign_id, faction_id, action_type, target_type, target_id, pressure_cost, status, cooldown_until, triggered_by, parent_action_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, 'cascade', $8)`,
    [campaignId, rivalFactionId, selectedType, parentAction.target_type, parentAction.target_id, cost, cooldownUntil, parentAction.id]
  );
}

/**
 * Phase 8: Recalculate Territory Control percentages
 */
export async function updateTerritoryControl(client: PoolClient | Pool, campaignId: string): Promise<void> {
  const locationsRes = await client.query("SELECT id, name FROM public.locations WHERE campaign_id = $1", [campaignId]);
  const locations = locationsRes.rows;

  for (const loc of locations) {
    // Get all territory stats for this location
    const terrRes = await client.query(
      `SELECT * FROM public.faction_territories
       WHERE campaign_id = $1 AND location_id = $2`,
      [campaignId, loc.id]
    );
    const territories: FactionTerritory[] = terrRes.rows;

    const totalPressure = territories.reduce((sum, t) => sum + t.pressure_value, 0);

    if (totalPressure === 0) {
      await client.query(
        "UPDATE public.faction_territories SET control_percent = 0, is_claimed = false WHERE location_id = $1 AND campaign_id = $2",
        [loc.id, campaignId]
      );

      // Clear controlling faction in location state
      await client.query(
        `UPDATE public.locations
         SET state = state - 'controlling_faction_id'
         WHERE id = $1`,
        [loc.id]
      );
    } else {
      let maxControlPercent = -1;
      let dominantFactionId: string | null = null;

      for (const terr of territories) {
        const controlPercent = Math.round((terr.pressure_value / totalPressure) * 100);

        if (controlPercent > maxControlPercent) {
          maxControlPercent = controlPercent;
          dominantFactionId = terr.faction_id;
        }

        await client.query(
          "UPDATE public.faction_territories SET control_percent = $1 WHERE id = $2",
          [controlPercent, terr.id]
        );
      }

      // Claim status: dominant faction has control >= 50%
      if (maxControlPercent >= 50 && dominantFactionId) {
        await client.query(
          "UPDATE public.faction_territories SET is_claimed = true WHERE location_id = $1 AND faction_id = $2",
          [loc.id, dominantFactionId]
        );
        await client.query(
          "UPDATE public.faction_territories SET is_claimed = false WHERE location_id = $1 AND faction_id != $2",
          [loc.id, dominantFactionId]
        );

        let law = "anarchy";
        let tax = 0;
        let patrolStr = "none";
        if (maxControlPercent >= 80) {
          law = "strict_martial_law";
          tax = 15;
          patrolStr = "heavy";
        } else if (maxControlPercent >= 60) {
          law = "regulated";
          tax = 10;
          patrolStr = "moderate";
        } else if (maxControlPercent >= 40) {
          law = "contested";
          tax = 5;
          patrolStr = "light";
        } else if (maxControlPercent >= 20) {
          law = "unstable";
          tax = 2;
          patrolStr = "minimal";
        }

        // Update location state with dominant faction and simulation state
        await client.query(
          `UPDATE public.locations
           SET state = state || jsonb_build_object(
             'controlling_faction_id', $1::text,
             'law', $2::text,
             'tax_percent', $3::int,
             'patrol_level', $4::text
           )
           WHERE id = $5`,
          [dominantFactionId, law, tax, patrolStr, loc.id]
        );
      } else {
        await client.query(
          "UPDATE public.faction_territories SET is_claimed = false WHERE location_id = $1",
          [loc.id]
        );

        // Clear controlling faction and reset state
        await client.query(
          `UPDATE public.locations
           SET state = state - 'controlling_faction_id' - 'law' - 'tax_percent' - 'patrol_level'
           WHERE id = $1`,
          [loc.id]
        );
      }
    }
  }

  // Recalculate territories column in public.factions
  const factionsRes = await client.query("SELECT id FROM public.factions WHERE campaign_id = $1", [campaignId]);
  for (const fac of factionsRes.rows) {
    const countRes = await client.query(
      `SELECT count(*) AS claimed_count FROM public.faction_territories
       WHERE faction_id = $1 AND is_claimed = true`,
      [fac.id]
    );
    const count = parseInt(countRes.rows[0].claimed_count, 10);
    await client.query("UPDATE public.factions SET territories = $1 WHERE id = $2", [count, fac.id]);
  }
}

/**
 * Phase 6: Diplomacy System (Truce, Trade, Alliance, Vassalage, AI Proposals, Betrayal, Decay)
 */
export async function evaluateDiplomacy(client: PoolClient | Pool, campaignId: string): Promise<void> {
  const relationsRes = await client.query(
    "SELECT * FROM public.faction_relations WHERE campaign_id = $1",
    [campaignId]
  );
  const relations: FactionRelation[] = relationsRes.rows;

  const factionsRes = await client.query("SELECT id, name, type, wealth FROM public.factions WHERE campaign_id = $1 AND collapsed = false", [campaignId]);
  const factions = factionsRes.rows;

  for (const rel of relations) {
    const isTreatyActive = rel.treaty_type !== "none";
    const isExpired = rel.treaty_expires_at ? new Date(rel.treaty_expires_at) <= new Date() : false;

    const factionAName = factions.find((f) => f.id === rel.faction_a_id)?.name ?? "Faction A";
    const factionBName = factions.find((f) => f.id === rel.faction_b_id)?.name ?? "Faction B";

    if (isExpired && isTreatyActive) {
      // Expire treaty
      await client.query(
        "UPDATE public.faction_relations SET treaty_type = 'none', treaty_expires_at = null WHERE id = $1",
        [rel.id]
      );
      const narrative = `The treaty between ${factionAName} and ${factionBName} has expired.`;
      await logEvent(client, campaignId, "system", { event: "treaty_expired", relation_id: rel.id, narrative });
      RoomManager.broadcastToRoom(campaignId, "FACTION_TREATY_SIGNED", {
        faction_a_id: rel.faction_a_id,
        faction_b_id: rel.faction_b_id,
        treaty_type: "none",
        narrative,
      });
      continue;
    }

    if (isTreatyActive && !isExpired) {
      // Vassalage tribute transfer
      if (rel.treaty_type === "vassalage") {
        const vassal = factions.find((f) => f.id === rel.faction_b_id);
        const liege = factions.find((f) => f.id === rel.faction_a_id);
        if (vassal && liege && vassal.wealth > 0) {
          const tribute = Math.round(vassal.wealth * 0.10);
          await client.query("UPDATE public.factions SET wealth = wealth - $1 WHERE id = $2", [tribute, vassal.id]);
          await client.query("UPDATE public.factions SET wealth = wealth + $1 WHERE id = $2", [tribute, liege.id]);
        }
      }
      continue; // Active treaties prevent relationship score decay
    }

    // Relation Decay: Drift towards 0
    let nextScore = rel.score;
    if (rel.score > 0) {
      nextScore = Math.max(0, rel.score - 2);
    } else if (rel.score < 0) {
      nextScore = Math.min(0, rel.score + 2);
    }
    await client.query("UPDATE public.faction_relations SET score = $1 WHERE id = $2", [nextScore, rel.id]);
    rel.score = nextScore;

    // AI Proposal logic: score > 40
    if (rel.score > 40 && Math.random() < 0.3) {
      const typeA = factions.find((f) => f.id === rel.faction_a_id)?.type;
      const typeB = factions.find((f) => f.id === rel.faction_b_id)?.type;

      let treatyType: TreatyType = "truce";
      if (typeA === "merchant" || typeB === "merchant") {
        treatyType = "trade";
      } else if (rel.score > 70) {
        treatyType = "alliance";
      }

      // Expires in 5 cycles (days)
      const expiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await client.query(
        "UPDATE public.faction_relations SET treaty_type = $1, treaty_expires_at = $2 WHERE id = $3",
        [treatyType, expiry, rel.id]
      );

      const narrative = `A ${treatyType} agreement has been signed between ${factionAName} and ${factionBName}.`;
      await logEvent(client, campaignId, "system", { event: "treaty_signed", treatyType, factionAName, factionBName, narrative });
      RoomManager.broadcastToRoom(campaignId, "FACTION_TREATY_SIGNED", {
        faction_a_id: rel.faction_a_id,
        faction_b_id: rel.faction_b_id,
        treaty_type: treatyType,
        narrative,
      });
    }

    // AI Betrayal logic: score < 0
    if (rel.score < 0 && Math.random() < 0.2) {
      // Betrayal triggers global relation penalty
      await client.query(
        `UPDATE public.faction_relations
         SET score = score - 30
         WHERE campaign_id = $1 AND (faction_a_id = $2 OR faction_b_id = $2)`,
        [campaignId, rel.faction_a_id]
      );

      await client.query(
        "UPDATE public.faction_relations SET score = score - 40, treaty_type = 'none', treaty_expires_at = null WHERE id = $1",
        [rel.id]
      );

      const narrative = `WAR! ${factionAName} has betrayed their treaty and declared war on ${factionBName}!`;
      await logEvent(client, campaignId, "system", { event: "war_declared", factionAName, factionBName, narrative });
      RoomManager.broadcastToRoom(campaignId, "FACTION_WAR_DECLARED", {
        faction_a_id: rel.faction_a_id,
        faction_b_id: rel.faction_b_id,
        narrative,
      });
    }
  }
}

/**
 * Phase 4.8: Faction Bankruptcy collapse checks
 */
export async function handleFactionBankruptcy(client: PoolClient | Pool, campaignId: string): Promise<void> {
  const factionsRes = await client.query("SELECT * FROM public.factions WHERE campaign_id = $1 AND collapsed = false", [campaignId]);
  const factions = factionsRes.rows.map(rowToFaction);

  for (const fac of factions) {
    if (fac.wealth > 0) continue;

    // Stability drops by 20 if wealth is 0
    const nextStability = Math.max(0, fac.stability - 20);

    if (nextStability <= 0) {
      // Faction collapses!
      await client.query(
        `UPDATE public.factions
         SET collapsed = true, stability = 0, military = 0, influence = 0, wealth = 0, pressure = 0
         WHERE id = $1`,
        [fac.id]
      );

      // Release territories
      await client.query(
        "UPDATE public.faction_territories SET is_claimed = false, control_percent = 0, pressure_value = 0 WHERE faction_id = $1",
        [fac.id]
      );

      const narrative = `The ${fac.name} has declared bankruptcy and collapsed! Their territories have fallen into anarchy.`;
      await logEvent(client, campaignId, "system", { event: "faction_collapsed", faction_id: fac.id, faction_name: fac.name, narrative });
      RoomManager.broadcastToRoom(campaignId, "FACTION_COLLAPSED", {
        faction_id: fac.id,
        narrative,
      });

      // Encyclopedia: record faction collapse as high-importance history event
      const factionEntryRes = await client.query(
        "SELECT id FROM public.encyclopedia_entries WHERE source_type = 'faction' AND source_id = $1",
        [fac.id]
      );
      if (factionEntryRes.rows.length > 0) {
        const importance = computeImportance({ factions_involved: 3, locations_affected: fac.territories });
        void recordHistoryEvent(
          client, campaignId, factionEntryRes.rows[0].id,
          "faction_collapse",
          `${fac.name} Collapses`,
          narrative,
          importance,
          { sourceType: "faction", sourceId: fac.id }
        ).catch(() => {});
      }
    } else {
      await client.query("UPDATE public.factions SET stability = $1 WHERE id = $2", [nextStability, fac.id]);
    }
  }
}

/**
 * Phase 7: Player Reputation tiers, bounties, and nemesis promotes
 */
export async function updatePlayerReputation(client: PoolClient | Pool, campaignId: string): Promise<void> {
  const repsRes = await client.query("SELECT * FROM public.player_faction_reputation WHERE campaign_id = $1", [campaignId]);
  const reputations: PlayerFactionReputation[] = repsRes.rows;

  const factionsRes = await client.query("SELECT id, name FROM public.factions WHERE campaign_id = $1", [campaignId]);
  const factions = factionsRes.rows;

  for (const rep of reputations) {
    let nextTier: ReputationTier = "unknown";
    let bounty = 0;

    if (rep.score >= 80) {
      nextTier = "legend";
    } else if (rep.score >= 50) {
      nextTier = "champion";
    } else if (rep.score <= -80) {
      nextTier = "hunted";
      bounty = 2000;
    } else if (rep.score <= -50) {
      nextTier = "wanted";
      bounty = 500;
    } else if (rep.score <= -20) {
      nextTier = "watched";
    } else {
      nextTier = "unknown";
    }

    if (nextTier !== rep.tier) {
      await client.query(
        "UPDATE public.player_faction_reputation SET tier = $1, bounty_amount = $2 WHERE id = $3",
        [nextTier, bounty, rep.id]
      );

      const factionName = factions.find((f) => f.id === rep.faction_id)?.name ?? "Faction";
      const charRes = await client.query("SELECT name FROM public.characters WHERE id = $1", [rep.character_id]);
      const charName = charRes.rows[0]?.name ?? "Character";

      const narrative = `${charName}'s reputation with ${factionName} is now: ${nextTier.toUpperCase()}.`;
      await logEvent(client, campaignId, "system", { event: "reputation_changed", character_id: rep.character_id, faction_id: rep.faction_id, tier: nextTier, narrative });

      RoomManager.broadcastToRoom(campaignId, "PLAYER_REP_CHANGED", {
        character_id: rep.character_id,
        faction_id: rep.faction_id,
        score: rep.score,
        tier: nextTier,
        narrative,
      });

      // NEMESIS promotion trigger
      if (nextTier === "hunted") {
        // Find if there is an active nemesis from this faction targeting this character
        const activeNemesisRes = await client.query(
          `SELECT id FROM public.nemeses
           WHERE campaign_id = $1 AND faction_id = $2 AND target_character_id = $3 AND status = 'active'`,
          [campaignId, rep.faction_id, rep.character_id]
        );

        if (activeNemesisRes.rows.length === 0) {
          // Promote a lieutenant/agent of this faction to Nemesis, or write a narrative threat
          const npcAgentRes = await client.query(
            `SELECT n.id, n.name FROM public.npcs n
             JOIN public.npc_faction_alignment a ON a.npc_id = n.id
             WHERE n.campaign_id = $1 AND a.faction_id = $2 AND n.is_alive = true LIMIT 1`,
            [campaignId, rep.faction_id]
          );

          if (npcAgentRes.rows.length > 0) {
            const candidateNpc = npcAgentRes.rows[0];
            const nemesisId = crypto.randomUUID();

            await client.query(
              `INSERT INTO public.nemeses (id, campaign_id, name, tier, status, level, xp, personality, traits, tactics, stats, scars, appearance, faction_id, target_character_id, grudge_score, bounty_on_party, minion_ids)
               VALUES ($1, $2, $3, 'lieutenant', 'active', 3, 300, 'vengeful', '{"fixated": true}', '{}', '{"hp": 30}', '[]', '{}', $4, $5, 80, $6, '{}')`,
              [nemesisId, campaignId, candidateNpc.name, rep.faction_id, rep.character_id, bounty]
            );

            const promoNarrative = `THREAT DETECTED! ${candidateNpc.name} from the ${factionName} has been assigned to hunt down ${charName}!`;
            // logEvent inserts to event_log and returns the real UUID — use it for the broadcast
            const promoEventId = await logEvent(client, campaignId, "exploration", {
              action_type: "nemesis_promoted",
              text: promoNarrative,
              actor_name: factionName,
            });
            RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
              id: promoEventId,
              type: "exploration",
              actor_name: factionName,
              payload: { text: promoNarrative },
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
  }
}

/**
 * Phase 4.10: Check victory conditions per faction type
 */
export async function checkVictoryConditions(client: PoolClient | Pool, campaignId: string): Promise<void> {
  const factionsRes = await client.query("SELECT * FROM public.factions WHERE campaign_id = $1 AND collapsed = false", [campaignId]);
  const factions = factionsRes.rows.map(rowToFaction);

  for (const fac of factions) {
    const config = VICTORY_CONDITIONS[fac.type];
    if (!config) continue;

    let qualifies = true;

    if (fac.territories < config.requiredTerritories) qualifies = false;
    if (fac.stability < config.minStability) qualifies = false;
    if (config.minMilitary && fac.military < config.minMilitary) qualifies = false;
    if (config.minWealth && fac.wealth < config.minWealth) qualifies = false;
    if (config.minInfluence && fac.influence < config.minInfluence) qualifies = false;

    // Check individual territory control %
    if (qualifies) {
      const terrRes = await client.query(
        "SELECT control_percent FROM public.faction_territories WHERE faction_id = $1 AND is_claimed = true",
        [fac.id]
      );
      const belowMin = terrRes.rows.some((t) => t.control_percent < config.minTerritoryControl);
      if (belowMin) qualifies = false;
    }

    if (qualifies && !fac.is_victorious) {
      await client.query("UPDATE public.factions SET is_victorious = true WHERE id = $1", [fac.id]);
      const narrative = `VICTORY! The ${fac.name} has fulfilled all victory conditions and achieved total dominance!`;
      await logEvent(client, campaignId, "system", { event: "faction_victory", faction_id: fac.id, faction_name: fac.name, narrative });
      RoomManager.broadcastToRoom(campaignId, "FACTION_VICTORY", {
        faction_id: fac.id,
        narrative,
      });
    }
  }
}

/**
 * Phase 4.11: Master Heartbeat cycle runner
 */
export async function runFactionCycle(client: PoolClient | Pool, campaignId: string, force = false): Promise<void> {
  try {
    // Check if the engine is paused
    if (!force) {
      const campaignRes = await client.query("SELECT world_state FROM public.campaigns WHERE id = $1", [campaignId]);
      if (campaignRes.rows.length > 0) {
        const state = campaignRes.rows[0].world_state || {};
        if (state.faction_engine_paused === true) {
          return; // Engine is paused, skip cycle execution
        }
      }
    }

    // Get current cycle number
    const cycleNumber = await getNextCycleNumber(client, campaignId);

    // Step 1: Resolve all pending actions (bypassing if they have linked active quests)
    const pendingActionsRes = await client.query(
      "SELECT id FROM public.faction_actions WHERE campaign_id = $1 AND status = 'pending'",
      [campaignId]
    );
    for (const act of pendingActionsRes.rows) {
      const questCheck = await client.query(
        `SELECT status FROM public.quests
         WHERE campaign_id = $1 AND objectives::jsonb @> $2::jsonb LIMIT 1`,
        [campaignId, JSON.stringify([{ action_id: act.id }])]
      );

      if (questCheck.rows.length > 0) {
        const qStatus = questCheck.rows[0].status;
        if (qStatus === "active") {
          continue; // Keep action pending; do not auto-resolve before player engagement
        } else if (qStatus === "complete") {
          await client.query("UPDATE public.faction_actions SET status = 'countered', resolved_at = now() WHERE id = $1", [act.id]);
          continue;
        }
      }

      await resolveAction(client, campaignId, act.id, false);
    }

    // Step 2: Evaluate diplomacy decays, active treaties, tribute, proposals
    await evaluateDiplomacy(client, campaignId);

    // Step 3: Handle faction bankruptcies and stability collapses
    await handleFactionBankruptcy(client, campaignId);

    // Step 4: Recalculate control percentages and claims
    await updateTerritoryControl(client, campaignId);

    // Step 5: Update player reputation tiers and nemeses
    await updatePlayerReputation(client, campaignId);

    // Step 6: Check victory condition locks
    await checkVictoryConditions(client, campaignId);

    // Step 7: Generate pressure and decay excess
    await generatePressure(client, campaignId, cycleNumber);

    // Step 8: Select new actions for the next cycle
    await selectActions(client, campaignId);

  } catch (err) {
    console.error("runFactionCycle error:", err);
  }
}

/**
 * Phase 10: Handle faction quest completion, apply reputation shifts, mark action as countered
 */
export async function handleFactionQuestCompletion(
  client: PoolClient | Pool,
  campaignId: string,
  quest: any
): Promise<void> {
  const objectives = Array.isArray(quest.objectives) ? quest.objectives : [];
  const factionObjective = objectives.find((obj: any) => obj.action_id);
  if (!factionObjective) return;

  const actionId = factionObjective.action_id;

  // Fetch faction action
  const actionRes = await client.query("SELECT * FROM public.faction_actions WHERE id = $1", [actionId]);
  if (actionRes.rows.length === 0) return;
  const action = actionRes.rows[0];

  const oppFactionId = action.faction_id;

  // Mark action as countered
  await client.query(
    "UPDATE public.faction_actions SET status = 'countered', resolved_at = now() WHERE id = $1",
    [actionId]
  );

  // Broadcast countered action
  RoomManager.broadcastToRoom(campaignId, "FACTION_ACTION_RESOLVED", {
    action: {
      ...action,
      status: "countered",
      resolved_at: new Date().toISOString()
    },
    narrative: `The party successfully thwarted the ${action.action_type} planned by the opposing faction.`
  });

  // Determine reputation changes
  const charactersRes = await client.query("SELECT id FROM public.characters WHERE campaign_id = $1 AND is_alive = true", [campaignId]);
  const characterIds = charactersRes.rows.map((r) => r.id);

  if (action.action_type === "fund_trade_route") {
    // Caravan escort succeeded (helped opposing faction)
    for (const charId of characterIds) {
      await client.query(
        `INSERT INTO public.player_faction_reputation (campaign_id, character_id, faction_id, score, tier)
         VALUES ($1, $2, $3, 15, 'unknown')
         ON CONFLICT (campaign_id, character_id, faction_id)
         DO UPDATE SET score = LEAST(100, player_faction_reputation.score + 15)`,
        [campaignId, charId, oppFactionId]
      );
    }
  } else {
    // Raid/siege/assassination was stopped (opposed faction)
    for (const charId of characterIds) {
      // Decrease rep with opposing faction
      await client.query(
        `INSERT INTO public.player_faction_reputation (campaign_id, character_id, faction_id, score, tier)
         VALUES ($1, $2, $3, -15, 'unknown')
         ON CONFLICT (campaign_id, character_id, faction_id)
         DO UPDATE SET score = GREATEST(-100, player_faction_reputation.score - 15)`,
        [campaignId, charId, oppFactionId]
      );

      // Increase rep with the target's faction if it's a faction/npc/location
      let targetFactionId: string | null = null;
      if (action.target_type === "faction") {
        targetFactionId = action.target_id;
      } else if (action.target_type === "npc") {
        const npcAlign = await client.query("SELECT faction_id FROM public.npc_faction_alignment WHERE npc_id = $1 LIMIT 1", [action.target_id]);
        if (npcAlign.rows.length > 0) targetFactionId = npcAlign.rows[0].faction_id;
      } else if (action.target_type === "location") {
        const locTerr = await client.query("SELECT faction_id FROM public.faction_territories WHERE location_id = $1 AND is_claimed = true LIMIT 1", [action.target_id]);
        if (locTerr.rows.length > 0) targetFactionId = locTerr.rows[0].faction_id;
      }

      if (targetFactionId) {
        await client.query(
          `INSERT INTO public.player_faction_reputation (campaign_id, character_id, faction_id, score, tier)
           VALUES ($1, $2, $3, 15, 'unknown')
           ON CONFLICT (campaign_id, character_id, faction_id)
           DO UPDATE SET score = LEAST(100, player_faction_reputation.score + 15)`,
          [campaignId, charId, targetFactionId]
        );
      }
    }
  }

  // Update reputation tiers
  await updatePlayerReputation(client, campaignId);
}

