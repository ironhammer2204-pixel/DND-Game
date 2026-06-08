import { Pool, PoolClient } from "pg";
import { pool } from "../db/client";
import { ServerMessageMap } from "@dnd/shared";
import { runWorldHeartbeat, recordBehaviourEvent } from "./worldEngine.js";
import { dmService } from "../ai/dmService.js";
import { buildCampaignSnapshot, getLocationContext } from "../ai/contextBuilder";

type ActionType = "exploration" | "skill_check" | "npc_interaction" | "other";

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
}

const VALID_ACTION_TYPES = new Set<ActionType>(["exploration", "skill_check", "npc_interaction", "other"]);

interface CampaignWorldState {
  starting_location_id?: string;
  discovered_location_ids?: string[];
  character_locations?: Record<string, string>;
}

async function processSkillCheckAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  actionText: string
): Promise<ProcessedAction> {
  const charRes = await client.query(
    `SELECT skills FROM public.characters WHERE id = $1`,
    [participant.characterId]
  );

  if (charRes.rows.length === 0) {
    throw new Error("Character not found");
  }

  const skills = charRes.rows[0].skills || {};
  const skillKeys = Object.keys(skills);
  const chosenSkill = skillKeys[Math.floor(Math.random() * skillKeys.length)] || "perception";
  const skillBonus = (skills[chosenSkill] || 0) as number;
  const rawRoll = Math.floor(Math.random() * 20) + 1;
  const finalValue = rawRoll + skillBonus;

  const payload = {
    action_type: "skill_check",
    text: actionText,
    actor_name: characterName,
    skill: chosenSkill,
    raw_roll: rawRoll,
    skill_bonus: skillBonus,
    final_value: finalValue,
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'skill_check', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  let checkTags: string[] = [];
  if (["stealth", "deception", "sleightOfHand"].includes(chosenSkill)) {
    checkTags.push("shadow");
  } else if (["investigation", "arcana", "nature", "history", "religion"].includes(chosenSkill)) {
    checkTags.push("curiosity");
  }
  if (checkTags.length > 0 && participant.characterId) {
    await recordBehaviourEvent(client, participant.campaignId, participant.characterId, "skill_check", checkTags, 1);
  }

  if (dmService.isEnabled() && logRes.rows[0].id) {
    const snapshot = await buildCampaignSnapshot(client, participant.campaignId);
    dmService.enqueueSkillCheck(pool, logRes.rows[0].id, participant.campaignId, {
      campaignId: participant.campaignId,
      party: snapshot.party,
      location: snapshot.location ?? { name: "unknown", description: "" },
      characterName: characterName,
      skill: chosenSkill,
      success: finalValue >= 10,
      context: actionText,
    });
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

async function processMovementAction(
  client: PoolClient,
  participant: ActionParticipant,
  characterName: string,
  targetLocationId: string
): Promise<ProcessedAction> {
  const campaignRes = await client.query("SELECT world_state FROM public.campaigns WHERE id = $1 FOR UPDATE", [
    participant.campaignId,
  ]);

  if (campaignRes.rows.length === 0) {
    throw new Error("Campaign not found");
  }

  const worldState = (campaignRes.rows[0].world_state || {}) as CampaignWorldState;
  const currentLocationId =
    worldState.character_locations?.[participant.characterId || ""] || worldState.starting_location_id;

  if (!currentLocationId) {
    throw new Error("Campaign world has no starting location yet");
  }

  const locationsRes = await client.query(
    `SELECT id, name, connected_locations
     FROM public.locations
     WHERE campaign_id = $1 AND id = ANY($2::uuid[])`,
    [participant.campaignId, [currentLocationId, targetLocationId]]
  );

  const currentLocation = locationsRes.rows.find((location) => location.id === currentLocationId);
  const targetLocation = locationsRes.rows.find((location) => location.id === targetLocationId);

  if (!currentLocation || !targetLocation) {
    throw new Error("Location not found in this campaign");
  }

  if (currentLocation.id !== targetLocation.id && !currentLocation.connected_locations.includes(targetLocation.id)) {
    throw new Error(`${targetLocation.name} is not connected to your current location`);
  }

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
  };

  await client.query("UPDATE public.campaigns SET world_state = $1 WHERE id = $2", [
    JSON.stringify(nextWorldState),
    participant.campaignId,
  ]);
  await client.query("UPDATE public.locations SET state = state || $1::jsonb WHERE id = $2", [
    JSON.stringify({ discovered: true }),
    targetLocation.id,
  ]);

  const payload = {
    action_type: "movement",
    text: `${characterName} travels from ${currentLocation.name} to ${targetLocation.name}.`,
    actor_name: characterName,
    from_location_id: currentLocation.id,
    from_location_name: currentLocation.name,
    to_location_id: targetLocation.id,
    to_location_name: targetLocation.name,
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [participant.campaignId, participant.characterId, JSON.stringify(payload)]
  );

  if (dmService.isEnabled() && logRes.rows[0].id) {
    const snapshot = await buildCampaignSnapshot(client, participant.campaignId);
    const previousLocation = await getLocationContext(client, currentLocation.id);
    dmService.enqueueMovement(pool, logRes.rows[0].id, participant.campaignId, {
      campaignId: participant.campaignId,
      party: snapshot.party,
      fromLocation: previousLocation ?? { name: "unknown", description: "" },
      toLocation: snapshot.location ?? { name: "unknown", description: "" },
      npcs: snapshot.npcs,
      recentEvents: snapshot.recentEvents,
    });
  }

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
  };
}

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

  if (input.target_location_id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await processMovementAction(client, participant, characterName, input.target_location_id);
      await runWorldHeartbeat(client, participant.campaignId, false);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const isRestAction = text ? text.toLowerCase().includes("rest") : false;

  if (actionType === "skill_check") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await processSkillCheckAction(client, participant, characterName, text);
      await runWorldHeartbeat(client, participant.campaignId, isRestAction);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const payload = {
    action_type: actionType,
    text,
    actor_name: characterName,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const logRes = await client.query(
      "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
      [participant.campaignId, participant.characterId, JSON.stringify(payload)]
    );
    await runWorldHeartbeat(client, participant.campaignId, isRestAction);
    await client.query("COMMIT");

    if (text && participant.characterId) {
      dmService.enqueueIntentClassification(pool, participant.characterId, participant.campaignId, text);
    }

    if (dmService.isEnabled() && logRes.rows[0].id) {
      const snapshot = await buildCampaignSnapshot(client, participant.campaignId);
      dmService.enqueueAction(pool, logRes.rows[0].id, participant.campaignId, {
        campaignId: participant.campaignId,
        party: snapshot.party,
        location: snapshot.location ?? { name: "unknown", description: "" },
        npcs: snapshot.npcs,
        quests: snapshot.quests,
        recentEvents: snapshot.recentEvents,
        actorName: characterName,
        actionDescription: text ?? "took an action",
        serverResult: "resolved by server",
      });
    }

    return {
      event: {
        id: logRes.rows[0].id,
        type: "exploration",
        actor_name: payload.actor_name,
        payload,
        timestamp: logRes.rows[0].created_at,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
