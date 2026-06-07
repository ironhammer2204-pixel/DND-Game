import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { ClientWSMessage, ClientMessageType, Character } from "@dnd/shared";
import { RoomManager } from "./roomManager";
import { pool } from "../db/client";
import { rollDice } from "../game/diceEngine";
import { processPlayerAction } from "../game/actionProcessor";

export interface DecodedToken {
  sub: string;
  email?: string;
  user_metadata?: {
    username?: string;
  };
}

// Authenticate socket token
export function authenticateSocket(token: string): { userId: string; username: string } | null {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("JWT_SECRET is not configured on the server.");
    return null;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as DecodedToken;
    return {
      userId: decoded.sub,
      username: decoded.user_metadata?.username || decoded.email || "Unknown Player",
    };
  } catch {
    return null;
  }
}

async function sendRecentEvents(ws: WebSocket, campaignId: string): Promise<void> {
  const eventsRes = await pool.query(
    `SELECT e.id, e.type, e.payload, e.created_at, COALESCE(c.name, u.username) AS actor_name
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

        // 5. Broadcast player joined to room
        RoomManager.broadcastToRoom(campaignId, "PLAYER_JOINED", {
          user_id: user.userId,
          username: user.username,
          character,
        });

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

        // Broadcast player joined (acting as reconnect notice)
        RoomManager.broadcastToRoom(campaign_id, "PLAYER_JOINED", {
          user_id: user.userId,
          username: user.username,
          character,
        });

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
          const { event } = await processPlayerAction(pool, participant, msg.payload);
          RoomManager.broadcastToRoom(participant.campaignId, "GAME_EVENT", event);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unable to process action";
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

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
