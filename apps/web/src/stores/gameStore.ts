import { create } from "zustand";
import type { Character, Campaign, ServerWSMessage, ServerMessageType, ServerMessageMap, CombatEncounter, Location } from "@dnd/shared";


export interface LobbyCampaign extends Campaign {
  role: "player" | "dm";
  owner_name: string;
}

export interface SystemEvent {
  id: string;
  type: "system";
  payload: { text: string };
  timestamp: string;
  actor_name?: never;
}

type GameEvent = ServerMessageMap["GAME_EVENT"];
export type GameOrSystemEvent = (GameEvent | SystemEvent) & { ai_narration?: string | null };

export type WsStatus = "disconnected" | "connecting" | "connected";

interface GameState {
  activeCampaign: LobbyCampaign | null;
  activeRole: "player" | "dm" | null;
  campaigns: LobbyCampaign[];
  partyCharacters: Character[];
  myCharacter: Character | null;
  eventLogs: GameOrSystemEvent[];
  activeCombat: CombatEncounter | null;
  ws: WebSocket | null;
  wsStatus: WsStatus;
  locations: Location[];
  activeRoll: ServerMessageMap["DICE_RESULT"] | null;
  rollQueue: ServerMessageMap["DICE_RESULT"][];

  setCampaigns: (campaigns: LobbyCampaign[]) => void;
  setActiveCampaign: (campaign: LobbyCampaign | null, role: "player" | "dm" | null) => void;
  setPartyCharacters: (chars: Character[]) => void;
  setMyCharacter: (char: Character | null) => void;
  appendEvent: (event: GameOrSystemEvent) => void;
  clearEvents: () => void;
  setActiveCombat: (combat: CombatEncounter | null) => void;
  setWs: (ws: WebSocket | null) => void;
  setWsStatus: (status: WsStatus) => void;
  setLocations: (locations: Location[]) => void;
  enqueueRoll: (roll: ServerMessageMap["DICE_RESULT"]) => void;
  dismissActiveRoll: () => void;
  handleWsMessage: (message: ServerWSMessage<ServerMessageType>, userId: string, fetchParty: (id: string) => void) => void;
  reset: () => void;
}

const initialState = {
  activeCampaign: null,
  activeRole: null as "player" | "dm" | null,
  campaigns: [] as LobbyCampaign[],
  partyCharacters: [] as Character[],
  myCharacter: null as Character | null,
  eventLogs: [] as GameOrSystemEvent[],
  activeCombat: null as CombatEncounter | null,
  ws: null as WebSocket | null,
  wsStatus: "disconnected" as WsStatus,
  locations: [] as Location[],
  activeRoll: null as ServerMessageMap["DICE_RESULT"] | null,
  rollQueue: [] as ServerMessageMap["DICE_RESULT"][],
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,

  setCampaigns: (campaigns) => set({ campaigns }),

  setActiveCampaign: (campaign, role) => set({ activeCampaign: campaign, activeRole: role }),

  setPartyCharacters: (chars) => set({ partyCharacters: chars }),

  setMyCharacter: (char) => set({ myCharacter: char }),

  appendEvent: (event) =>
    set((state) => ({ eventLogs: [...state.eventLogs, event] })),

  clearEvents: () => set({ eventLogs: [] }),

  setActiveCombat: (combat) => set({ activeCombat: combat }),

  setWs: (ws) => set({ ws }),

  setWsStatus: (status) => set({ wsStatus: status }),

  setLocations: (locations) => set({ locations }),

  enqueueRoll: (roll) => set((state) => {
    if (state.activeRoll) {
      return { rollQueue: [...state.rollQueue, roll] };
    } else {
      return { activeRoll: roll };
    }
  }),

  dismissActiveRoll: () => set((state) => {
    const nextRoll = state.rollQueue[0] || null;
    const nextQueue = state.rollQueue.slice(1);
    return {
      activeRoll: nextRoll,
      rollQueue: nextQueue,
    };
  }),

  handleWsMessage: (message, userId, fetchParty) => {
    const { activeCampaign, appendEvent } = get();
    if (!activeCampaign) return;

    switch (message.type) {
      case "PLAYER_JOINED": {
        const payload = message.payload as {
          user_id: string;
          username: string;
          character?: Character | null;
        };
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `${payload.username} entered the campaign room.` },
          timestamp: new Date().toISOString(),
        });
        fetchParty(activeCampaign.id);
        if (payload.user_id === userId && payload.character) {
          set({ myCharacter: payload.character });
        }
        break;
      }
      case "PLAYER_LEFT": {
        const payload = message.payload as { username: string };
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `${payload.username} left the campaign room.` },
          timestamp: new Date().toISOString(),
        });
        break;
      }
      case "AI_NARRATION": {
        const payload = message.payload as ServerMessageMap["AI_NARRATION"];
        set((state) => ({
          eventLogs: state.eventLogs.map((evt) =>
            evt.id === payload.event_id
              ? { ...evt, ai_narration: payload.text }
              : evt
          ),
        }));
        break;
      }

        case "GAME_EVENT": {
        const gameEvent = message.payload as GameEvent;
        appendEvent(gameEvent);
        break;
      }
      case "COMBAT_UPDATE": {
        const payload = message.payload as { encounter: CombatEncounter };
        set({ activeCombat: payload.encounter.status === "active" ? payload.encounter : null });
        fetchParty(activeCampaign.id);
        break;
      }
      case "WORLD_UPDATE": {
        const payload = message.payload as ServerMessageMap["WORLD_UPDATE"];
        const campaign = get().activeCampaign;
        if (campaign) {
          const nextWorldState = {
            ...campaign.world_state,
            ...payload.changes,
          };
          set({
            activeCampaign: {
              ...campaign,
              world_state: nextWorldState,
            },
          });
        }
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `${payload.actor_name || "Someone"} traveled from ${payload.from_location || "Unknown"} to ${payload.to_location || "Unknown"}.` },
          timestamp: new Date().toISOString(),
        });
        fetchParty(activeCampaign.id);
        break;
      }
      case "DICE_RESULT": {
        const payload = message.payload as ServerMessageMap["DICE_RESULT"];
        get().enqueueRoll(payload);
        break;
      }
      case "ERROR": {
        const errorPayload = message.payload as { code: string; message: string };
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `⚠️ Server error: ${errorPayload.message}` },
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }
  },

  reset: () => set({ ...initialState }),
}));
