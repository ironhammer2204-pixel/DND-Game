import { WebSocket } from "ws";
import { ClientWSMessage, ClientMessageType, Character, KnowledgeLevel, KnowledgeDiscoverySource } from "@dnd/shared";
import { RoomManager } from "./roomManager";
import { pool } from "../db/client";
import { rollDice } from "../game/diceEngine";
import { processPlayerAction } from "../game/actionProcessor";
import { supabaseAdmin } from "../db/supabase";
import { startCombat, processCombatAction, rollDeathSave, getActiveEncounter } from "../game/combatEngine";
import { resolveAction, runFactionCycle } from "../game/factionEngine";
import { grantKnowledge, resolveRumor, generateSessionSummary } from "../game/encyclopediaEngine";
import { runBalancingCycle } from "../game/balancingEngine";


export interface DecodedToken {
  sub: string;
  email?: string;
  user_metadata?: {
    username?: string;
  };
}

export async function authenticateSocket(token: string): Promise<{ userId: string; username: string } | null> {
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return {
    userId: data.user.id,
    username: data.user.user_metadata?.username || data.user.email || "Unknown Player",
  };
}

async function sendRecentEvents(ws: WebSocket, campaignId: string): Promise<void> {
  const eventsRes = await pool.query(
    `SELECT e.id, e.type, e.payload, e.created_at, e.ai_narration,
            COALESCE(c.name, u.username) AS actor_name
     FROM public.event_log e
     LEFT JOIN public.characters c ON c.id = e.actor_id
     LEFT JOIN public.users u ON u.id = c.user_id
     WHERE e.campaign_id = $1
     ORDER BY e.created_at DESC
     LIMIT 50`,
    [campaignId]
  );

  for (const event of eventsRes.rows.reverse()) {
    RoomManager.sendToParticipant(ws, "GAME_EVENT", {
      id: event.id,
      type: event.type,
      actor_name: event.actor_name || undefined,
      payload: event.payload,
      timestamp: event.created_at,
      ai_narration: event.ai_narration ?? undefined,
    });
  }
}

export async function handleWSMessage(ws: WebSocket, rawMessage: string, user: { userId: string; username: string }) {
  try {
    const message = JSON.parse(rawMessage) as ClientWSMessage<ClientMessageType>;

    switch (message.type) {
      case "JOIN_CAMPAIGN": {
        const msg = message as ClientWSMessage<"JOIN_CAMPAIGN">;
        const { invite_code } = msg.payload;
        const inviteCode = invite_code?.trim().toUpperCase();

        if (!inviteCode) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: "Missing invite code",
          });
        }

        // 1. Find campaign by invite code
        const campaignRes = await pool.query(
          "SELECT id, name, owner_id FROM public.campaigns WHERE invite_code = $1",
          [inviteCode]
        );

        if (!campaignRes.rows || campaignRes.rows.length === 0) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "NOT_FOUND",
            message: "Campaign not found with the provided invite code",
          });
        }

        const campaignId = campaignRes.rows[0].id;
        const role = campaignRes.rows[0].owner_id === user.userId ? "dm" : "player";

        // 2. Add as member if not already (default to player role)
        await pool.query(
          `INSERT INTO public.campaign_members (campaign_id, user_id, role, last_seen_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (campaign_id, user_id)
           DO UPDATE SET last_seen_at = now()`,
          [campaignId, user.userId, role]
        );

        // 3. Fetch active character for this user in this campaign if they have one
        const charRes = await pool.query(
          "SELECT * FROM public.characters WHERE campaign_id = $1 AND user_id = $2 AND is_alive = true LIMIT 1",
          [campaignId, user.userId]
        );

        const character = charRes.rows && charRes.rows.length > 0 ? (charRes.rows[0] as Character) : null;

        // 4. Add to RoomManager
        const result = RoomManager.addParticipant(campaignId, user.userId, user.username, ws, character?.id);

        if (!result.success) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "ROOM_FULL",
            message: result.error || "Room is full",
          });
        }

        RoomManager.broadcastToRoom(campaignId, "PLAYER_JOINED", {
          user_id: user.userId,
          username: user.username,
          character,
        });

        // Send active combat if there is one
        const activeCombat = await getActiveEncounter(pool, campaignId);
        if (activeCombat) {
          RoomManager.sendToParticipant(ws, "COMBAT_UPDATE", { encounter: activeCombat });
        }

        await sendRecentEvents(ws, campaignId);

        break;
      }

      case "RECONNECT": {
        const msg = message as ClientWSMessage<"RECONNECT">;
        const { campaign_id, character_id } = msg.payload;

        if (!campaign_id) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: "Missing campaign_id for reconnect",
          });
        }

        // Verify membership
        const memberCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [campaign_id, user.userId]
        );

        if (!memberCheck.rows || memberCheck.rows.length === 0) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "You are not a member of this campaign",
          });
        }

        // Fetch character if id provided
        let character: Character | null = null;
        if (character_id) {
          const charRes = await pool.query(
            "SELECT * FROM public.characters WHERE id = $1 AND user_id = $2",
            [character_id, user.userId]
          );
          if (charRes.rows && charRes.rows.length > 0) {
            character = charRes.rows[0] as Character;
          }
        }

        await pool.query(
          "UPDATE public.campaign_members SET character_id = COALESCE($1, character_id), last_seen_at = now() WHERE campaign_id = $2 AND user_id = $3",
          [character?.id || null, campaign_id, user.userId]
        );

        // Register in RoomManager
        const result = RoomManager.addParticipant(campaign_id, user.userId, user.username, ws, character?.id || character_id);

        if (!result.success) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "ROOM_FULL",
            message: result.error || "Room is full",
          });
        }

        RoomManager.broadcastToRoom(campaign_id, "PLAYER_JOINED", {
          user_id: user.userId,
          username: user.username,
          character,
        });

        // Send active combat if there is one
        const activeCombat = await getActiveEncounter(pool, campaign_id);
        if (activeCombat) {
          RoomManager.sendToParticipant(ws, "COMBAT_UPDATE", { encounter: activeCombat });
        }

        await sendRecentEvents(ws, campaign_id);

        break;
      }

      case "CHAT_MESSAGE": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const msg = message as ClientWSMessage<"CHAT_MESSAGE">;
        const { text } = msg.payload;
        if (!text) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: "Empty chat message",
          });
        }

        const payload = { sender_name: participant.username, text };

        // 1. Insert chat event into event_log
        const logRes = await pool.query(
          "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'chat', $2, $3) RETURNING id, created_at",
          [participant.campaignId, participant.characterId || null, JSON.stringify(payload)]
        );

        const eventId = logRes.rows[0].id;
        const createdAt = logRes.rows[0].created_at;

        // 2. Broadcast game event to the campaign room
        RoomManager.broadcastToRoom(participant.campaignId, "GAME_EVENT", {
          id: eventId,
          type: "chat",
          actor_name: participant.username,
          payload,
          timestamp: createdAt,
        });

        break;
      }

      case "DICE_REQUEST": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const msg = message as ClientWSMessage<"DICE_REQUEST">;
        const { dice_type, context, modifier } = msg.payload;

        if (!dice_type) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: "Missing dice type",
          });
        }

        const { raw, final } = rollDice(dice_type, modifier || 0);

        // 1. If user has a character, insert into public.dice_rolls
        if (participant.characterId) {
          await pool.query(
            `INSERT INTO public.dice_rolls 
             (character_id, campaign_id, dice_type, raw_value, modifier, final_value, context) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              participant.characterId,
              participant.campaignId,
              dice_type,
              raw,
              modifier || 0,
              final,
              context || "",
            ]
          );
        }

        // 2. Broadcast result to the room
        RoomManager.broadcastToRoom(participant.campaignId, "DICE_RESULT", {
          roller_id: participant.userId,
          roller_name: participant.username,
          dice_type,
          raw,
          modifier: modifier || 0,
          final,
          context: context || "",
        });

        // 3. Also log as a game event
        const payload = {
          roller_name: participant.username,
          dice_type,
          raw,
          modifier: modifier || 0,
          final,
          context: context || "",
        };

        const logRes = await pool.query(
          "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
          [participant.campaignId, participant.characterId || null, JSON.stringify(payload)]
        );

        RoomManager.broadcastToRoom(participant.campaignId, "GAME_EVENT", {
          id: logRes.rows[0].id,
          type: "exploration",
          actor_name: participant.username,
          payload,
          timestamp: logRes.rows[0].created_at,
        });

        break;
      }

      case "ACTION_SUBMIT": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const msg = message as ClientWSMessage<"ACTION_SUBMIT">;

        try {
          const { event, worldUpdate } = await processPlayerAction(pool, participant, msg.payload);
          RoomManager.broadcastToRoom(participant.campaignId, "GAME_EVENT", event);
          if (worldUpdate) {
            RoomManager.broadcastToRoom(participant.campaignId, "WORLD_UPDATE", worldUpdate);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unable to process action";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

        break;
      }

      case "START_COMBAT": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        // Verify DM role
        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Only the DM can start combat.",
          });
        }

        const msg = message as ClientWSMessage<"START_COMBAT">;
        try {
          const encounter = await startCombat(participant.campaignId, msg.payload.monsters);
          RoomManager.broadcastToRoom(participant.campaignId, "COMBAT_UPDATE", { encounter });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to start combat";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }
        break;
      }

      case "COMBAT_ACTION": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const msg = message as ClientWSMessage<"COMBAT_ACTION">;
        const { action_type, target_id } = msg.payload;

        try {
          await processCombatAction(
            participant.campaignId,
            user.userId,
            action_type as any,
            target_id
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to process combat action";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }
        break;
      }

      case "DEATH_SAVE_ROLL": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        try {
          await rollDeathSave(participant.campaignId, user.userId);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to roll death save";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }
        break;
      }

      case "VETO_FACTION_ACTION": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Only the DM can veto faction actions.",
          });
        }

        const msg = message as ClientWSMessage<"VETO_FACTION_ACTION">;
        const { action_id } = msg.payload;

        try {
          await resolveAction(pool, participant.campaignId, action_id, true);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to veto action";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }
        break;
      }

      case "FORCE_FACTION_ACTION": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Only the DM can force faction actions.",
          });
        }

        const msg = message as ClientWSMessage<"FORCE_FACTION_ACTION">;
        const { faction_id, action_type, target_type, target_id } = msg.payload;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const actionRes = await client.query(
            `INSERT INTO public.faction_actions (campaign_id, faction_id, action_type, target_type, target_id, pressure_cost, status, cooldown_until, triggered_by)
             VALUES ($1, $2, $3, $4, $5, 0, 'pending', now(), 'dm')
             RETURNING id`,
            [participant.campaignId, faction_id, action_type, target_type, target_id]
          );
          const actionId = actionRes.rows[0].id;
          await resolveAction(client, participant.campaignId, actionId, false);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          const errorMessage = error instanceof Error ? error.message : "Failed to force action";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        } finally {
          client.release();
        }
        break;
      }

      case "PAUSE_FACTION_ENGINE": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Only the DM can pause/resume the engine.",
          });
        }

        const msg = message as ClientWSMessage<"PAUSE_FACTION_ENGINE">;
        const { pause } = msg.payload;

        try {
          await pool.query(
            `UPDATE public.campaigns
             SET world_state = jsonb_set(coalesce(world_state, '{}'::jsonb), '{faction_engine_paused}', $1::jsonb)
             WHERE id = $2`,
            [JSON.stringify(!!pause), participant.campaignId]
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to update engine state";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }
        break;
      }

      case "SET_FACTION_RELATION": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Only the DM can edit faction relations.",
          });
        }

        const msg = message as ClientWSMessage<"SET_FACTION_RELATION">;
        const { faction_a_id, faction_b_id, score, treaty_type, expires_in_days } = msg.payload;
        const expiry = expires_in_days ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000) : null;

        try {
          await pool.query(
            `INSERT INTO public.faction_relations (campaign_id, faction_a_id, faction_b_id, score, treaty_type, treaty_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (campaign_id, faction_a_id, faction_b_id)
             DO UPDATE SET score = EXCLUDED.score, treaty_type = EXCLUDED.treaty_type, treaty_expires_at = EXCLUDED.treaty_expires_at`,
            [participant.campaignId, faction_a_id, faction_b_id, score, treaty_type || "none", expiry]
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to set relation";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }
        break;
      }

      case "TRIGGER_FACTION_EVENT": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Only the DM can trigger faction events.",
          });
        }

        const msg = message as ClientWSMessage<"TRIGGER_FACTION_EVENT">;
        const { event_type } = msg.payload;

        if (event_type === "cycle") {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await runFactionCycle(client, participant.campaignId, true);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            const errorMessage = error instanceof Error ? error.message : "Failed to run faction cycle";
            return RoomManager.sendToParticipant(ws, "ERROR", {
              code: "BAD_REQUEST",
              message: errorMessage,
            });
          } finally {
            client.release();
          }
        }
        break;
      }

<<<<<<< HEAD
      // -----------------------------------------------------------------------
      // Encyclopedia: GRANT_KNOWLEDGE — DM grants a character knowledge of entry
      // -----------------------------------------------------------------------
      case "GRANT_KNOWLEDGE": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Not in a campaign room" });

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Only the DM can grant knowledge." });
        }

        const msg = message as ClientWSMessage<"GRANT_KNOWLEDGE">;
        const { character_id, entry_id, knowledge_level = 2, discovery_source = "dm_grant" } = msg.payload;

        try {
          const knowledge = await grantKnowledge(
            pool, character_id, entry_id, participant.campaignId,
            knowledge_level as KnowledgeLevel,
            discovery_source as KnowledgeDiscoverySource
          );
          // Notify only the target character's connection if online
          RoomManager.broadcastToRoom(participant.campaignId, "ENCYCLOPEDIA_KNOWLEDGE_GRANTED", {
            character_id, entry_id, knowledge_level, discovery_source,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to grant knowledge";
          return RoomManager.sendToParticipant(ws, "ERROR", { code: "BAD_REQUEST", message: errorMessage });
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Encyclopedia: RESOLVE_RUMOR — DM confirms/disproves a rumor
      // -----------------------------------------------------------------------
      case "RESOLVE_RUMOR": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Not in a campaign room" });

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Only the DM can resolve rumors." });
        }

        const msg = message as ClientWSMessage<"RESOLVE_RUMOR">;
        const { rumor_id, is_true } = msg.payload;

        try {
          await resolveRumor(pool, rumor_id, participant.campaignId, is_true);
          RoomManager.broadcastToRoom(participant.campaignId, "RUMOR_RESOLVED", {
            rumor_id,
            is_true,
            narrative: is_true ? "The rumor has been confirmed true." : "The rumor has been debunked.",
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to resolve rumor";
          return RoomManager.sendToParticipant(ws, "ERROR", { code: "BAD_REQUEST", message: errorMessage });
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Encyclopedia: TRIGGER_SESSION_SUMMARY — DM queues AI summarization
      // -----------------------------------------------------------------------
      case "TRIGGER_SESSION_SUMMARY": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Not in a campaign room" });

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Only the DM can trigger session summaries." });
        }

        const msg = message as ClientWSMessage<"TRIGGER_SESSION_SUMMARY">;
        const { session_id } = msg.payload;

        generateSessionSummary(pool, session_id, participant.campaignId).catch((err) =>
          console.error("[WS] generateSessionSummary error:", err)
        );
        RoomManager.sendToParticipant(ws, "GAME_EVENT", {
          id: "system",
          type: "system",
          payload: { message: `Session summary generation started for session ${session_id}` },
          timestamp: new Date().toISOString(),
        });
        break;
      }

      // -----------------------------------------------------------------------
      // Balance: TRIGGER_BALANCE_CYCLE — DM manually fires a balance cycle
      // -----------------------------------------------------------------------
      case "TRIGGER_BALANCE_CYCLE": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Not in a campaign room" });

        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", { code: "UNAUTHORIZED", message: "Only the DM can trigger a balance cycle." });
        }

        runBalancingCycle(pool, participant.campaignId).catch((err) =>
          console.error("[WS] runBalancingCycle error:", err)
        );
        RoomManager.sendToParticipant(ws, "GAME_EVENT", {
          id: "system",
          type: "system",
          payload: { message: "Balance cycle started. Dashboard will update shortly." },
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case "UPDATE_CONDITIONS": {
        const participant = RoomManager.getParticipantBySocket(ws);
        if (!participant) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Not joined in any campaign room",
          });
        }

        // DM only
        const dmCheck = await pool.query(
          "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
          [participant.campaignId, user.userId]
        );
        if (dmCheck.rows[0]?.role !== "dm") {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "UNAUTHORIZED",
            message: "Only the DM can toggle conditions.",
          });
        }

        const msg = message as ClientWSMessage<"UPDATE_CONDITIONS">;
        const { participant_id, condition, action } = msg.payload;

        // Load active encounter
        const encounter = await getActiveEncounter(pool, participant.campaignId);
        if (!encounter) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "NOT_FOUND",
            message: "No active combat encounter.",
          });
        }

        // Find and mutate participant in participants array
        const target = encounter.participants.find((p) => p.id === participant_id);
        if (!target) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "NOT_FOUND",
            message: "Participant not found in encounter.",
          });
        }

        if (action === "add" && !target.conditions.includes(condition)) {
          target.conditions.push(condition);
        } else if (action === "remove") {
          target.conditions = target.conditions.filter((c) => c !== condition);
        }

        // Mirror the change into turn_order (participant may appear in both arrays)
        const turnTarget = encounter.turn_order.find((p) => p.id === participant_id);
        if (turnTarget) {
          turnTarget.conditions = target.conditions;
        }

        // Persist and broadcast
        await pool.query(
          "UPDATE public.combat_encounters SET participants = $1, turn_order = $2 WHERE id = $3",
          [
            JSON.stringify(encounter.participants),
            JSON.stringify(encounter.turn_order),
            encounter.id,
          ]
        );

        RoomManager.broadcastToRoom(participant.campaignId, "COMBAT_UPDATE", { encounter });
        break;
      }

      default:
        RoomManager.sendToParticipant(ws, "ERROR", {
          code: "NOT_SUPPORTED",
          message: "Operation not fully supported in this phase",
        });
    }
  } catch (err) {
    console.error("Error handling WS message:", err);
    RoomManager.sendToParticipant(ws, "ERROR", {
      code: "INTERNAL_ERROR",
      message: "An internal server error occurred processing your request",
    });
  }
}
