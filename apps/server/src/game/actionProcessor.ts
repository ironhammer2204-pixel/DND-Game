import { Pool } from "pg";
import { ServerMessageMap } from "@dnd/shared";

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
}

export interface ProcessedAction {
  event: ServerMessageMap["GAME_EVENT"];
}

const VALID_ACTION_TYPES = new Set<ActionType>(["exploration", "skill_check", "npc_interaction", "other"]);

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

  const payload = {
    action_type: actionType,
    text,
    actor_name: memberCheck.rows[0].character_name || participant.username,
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
