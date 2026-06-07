import { WebSocket } from "ws";
import { ServerWSMessage, ServerMessageType, ServerMessageMap } from "@dnd/shared";

export interface Participant {
  ws: WebSocket;
  userId: string;
  username: string;
  characterId?: string;
  campaignId: string;
}

export class RoomManager {
  // Map of campaignId -> Map of userId -> Participant
  private static rooms = new Map<string, Map<string, Participant>>();

  // Map of ws -> Participant (for quick lookup on disconnect/message)
  private static connections = new Map<WebSocket, Participant>();

  public static addParticipant(
    campaignId: string,
    userId: string,
    username: string,
    ws: WebSocket,
    characterId?: string
  ): { success: boolean; error?: string } {
    let room = this.rooms.get(campaignId);
    if (!room) {
      room = new Map<string, Participant>();
      this.rooms.set(campaignId, room);
    }

    // Enforce 10 players limit
    if (room.size >= 10 && !room.has(userId)) {
      return { success: false, error: "Room is full (max 10 players)" };
    }

    const participant: Participant = {
      ws,
      userId,
      username,
      characterId,
      campaignId,
    };

    // If there's an existing connection for this user in this room, disconnect it first
    const existing = room.get(userId);
    if (existing) {
      try {
        existing.ws.close(1000, "Superceded by new connection");
      } catch {
        // Ignore close errors
      }
      this.connections.delete(existing.ws);
    }

    room.set(userId, participant);
    this.connections.set(ws, participant);

    return { success: true };
  }

  public static removeConnection(ws: WebSocket): Participant | undefined {
    const participant = this.connections.get(ws);
    if (!participant) return undefined;

    this.connections.delete(ws);
    const room = this.rooms.get(participant.campaignId);
    if (room) {
      room.delete(participant.userId);
      if (room.size === 0) {
        this.rooms.delete(participant.campaignId);
      }
    }

    return participant;
  }

  public static getParticipantBySocket(ws: WebSocket): Participant | undefined {
    return this.connections.get(ws);
  }

  public static getParticipantsInRoom(campaignId: string): Participant[] {
    const room = this.rooms.get(campaignId);
    if (!room) return [];
    return Array.from(room.values());
  }

  public static broadcastToRoom<T extends ServerMessageType>(
    campaignId: string,
    type: T,
    payload: ServerMessageMap[T]
  ): void {
    const participants = this.getParticipantsInRoom(campaignId);
    const message: ServerWSMessage<T> = { type, payload };
    const serialized = JSON.stringify(message);

    for (const p of participants) {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(serialized);
      }
    }
  }

  public static sendToParticipant<T extends ServerMessageType>(
    ws: WebSocket,
    type: T,
    payload: ServerMessageMap[T]
  ): void {
    if (ws.readyState === WebSocket.OPEN) {
      const message: ServerWSMessage<T> = { type, payload };
      ws.send(JSON.stringify(message));
    }
  }
}
