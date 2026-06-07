import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { ClientWSMessage, ClientMessageType, Character } from "@dnd/shared";
import { RoomManager } from "./roomManager";
import { pool } from "../db/client";
import { rollDice } from "../game/diceEngine";

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

export async function handleWSMessage(ws: WebSocket, rawMessage: string, user: { userId: string; username: string }) {
  try {
    const message = JSON.parse(rawMessage) as ClientWSMessage<ClientMessageType>;

    switch (message.type) {
      case "JOIN_CAMPAIGN": {
        const msg = message as ClientWSMessage<"JOIN_CAMPAIGN">;
        const { invite_code } = msg.payload;

        if (!invite_code) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "BAD_REQUEST",
            message: "Missing invite code",
          });
        }

        // 1. Find campaign by invite code
        const campaignRes = await pool.query(
          "SELECT id, name FROM public.campaigns WHERE invite_code = $1",
          [invite_code.toUpperCase()]
        );

        if (!campaignRes.rows || campaignRes.rows.length === 0) {
          return RoomManager.sendToParticipant(ws, "ERROR", {
            code: "NOT_FOUND",
            message: "Campaign not found with the provided invite code",
          });
        }

        const campaignId = campaignRes.rows[0].id;

        // 2. Add as member if not already (default to player role)
        await pool.query(
          "INSERT INTO public.campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player') ON CONFLICT (campaign_id, user_id) DO NOTHING",
          [campaignId, user.userId]
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

        // Register in RoomManager
        const result = RoomManager.addParticipant(campaign_id, user.userId, user.username, ws, character_id);

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
