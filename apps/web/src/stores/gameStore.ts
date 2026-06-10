import { create } from "zustand";
import type { 
  Character, 
  Campaign, 
  ServerWSMessage, 
  ServerMessageType, 
  ServerMessageMap, 
  CombatEncounter, 
  Location,
  Faction,
  FactionRelation,
  PlayerFactionReputation,
  FactionAction,
  ReputationTier
} from "@dnd/shared";

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

  // Faction state variables
  factions: Faction[];
  relations: FactionRelation[];
  reputations: PlayerFactionReputation[];
  factionActions: FactionAction[];
  factionEnginePaused: boolean;

  // AI narration buffer: handles the race where AI_NARRATION arrives before GAME_EVENT
  pendingNarrations: Record<string, string>;

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

  // Faction actions
  setFactions: (factions: Faction[]) => void;
  setRelations: (relations: FactionRelation[]) => void;
  setReputations: (reputations: PlayerFactionReputation[]) => void;
  setFactionActions: (actions: FactionAction[]) => void;
  setFactionEnginePaused: (paused: boolean) => void;
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

  // Factions initial state
  factions: [] as Faction[],
  relations: [] as FactionRelation[],
  reputations: [] as PlayerFactionReputation[],
  factionActions: [] as FactionAction[],
  factionEnginePaused: false,
  pendingNarrations: {} as Record<string, string>,
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,

  setCampaigns: (campaigns) => set({ campaigns }),

  setActiveCampaign: (campaign, role) => set({ activeCampaign: campaign, activeRole: role }),

  setPartyCharacters: (chars) => set({ partyCharacters: chars }),

  setMyCharacter: (char) => set({ myCharacter: char }),

  appendEvent: (event) =>
    set((state) => {
      // If a narration arrived before this event, attach it now
      const pending = state.pendingNarrations[event.id];
      const enriched = pending ? { ...event, ai_narration: pending } : event;
      const next = { ...state.pendingNarrations };
      if (pending) delete next[event.id];
      return {
        eventLogs: [...state.eventLogs, enriched],
        pendingNarrations: next,
      };
    }),

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

  // Faction setters
  setFactions: (factions) => set({ factions }),
  setRelations: (relations) => set({ relations }),
  setReputations: (reputations) => set({ reputations }),
  setFactionActions: (factionActions) => set({ factionActions }),
  setFactionEnginePaused: (factionEnginePaused) => set({ factionEnginePaused }),

  handleWsMessage: (message, userId, fetchParty) => {
    const { activeCampaign, appendEvent, factions, reputations, factionActions } = get();
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
        set((state) => {
          const eventExists = state.eventLogs.some((evt) => evt.id === payload.event_id);
          if (eventExists) {
            // Event already in state — patch it directly
            return {
              eventLogs: state.eventLogs.map((evt) =>
                evt.id === payload.event_id
                  ? { ...evt, ai_narration: payload.text }
                  : evt
              ),
            };
          } else {
            // Event hasn't arrived yet — buffer the narration
            return {
              pendingNarrations: {
                ...state.pendingNarrations,
                [payload.event_id]: payload.text,
              },
            };
          }
        });
        break;
      }

      case "GAME_EVENT": {
        const gameEvent = message.payload as GameEvent;
        // Check for buffered narration arriving out of order
        const pending = get().pendingNarrations[gameEvent.id];
        appendEvent(pending ? { ...gameEvent, ai_narration: pending } : gameEvent);
        if (pending) {
          set((state) => {
            const next = { ...state.pendingNarrations };
            delete next[gameEvent.id];
            return { pendingNarrations: next };
          });
        }
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
      case "WORLD_STATE_UPDATE": {
        const payload = message.payload as ServerMessageMap["WORLD_STATE_UPDATE"];
        const campaign = get().activeCampaign;
        if (campaign) {
          set({
            activeCampaign: {
              ...campaign,
              world_state: {
                ...campaign.world_state,
                current_weather: payload.weather,
                weather: payload.weather,
                time_of_day: payload.time_of_day,
                campaign_day: payload.campaign_day,
                weather_effects: payload.weather_effects,
                time_effects: payload.time_effects,
              },
            },
          });
        }
        break;
      }
      case "CAMPAIGN_LAUNCHED": {
        const payload = message.payload as ServerMessageMap["CAMPAIGN_LAUNCHED"];
        appendEvent({
          id: `launch-${payload.campaign_id}`,
          type: "system",
          payload: { text: payload.opening_narration },
          timestamp: new Date().toISOString(),
        });
        break;
      }
      case "WORLD_EVENT": {
        const payload = message.payload as ServerMessageMap["WORLD_EVENT"];
        appendEvent({
          id: payload.event_id,
          type: "system",
          payload: { text: payload.text, world_event: true },
          timestamp: payload.timestamp,
        });
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

      // Faction WS events
      case "FACTION_UPDATE": {
        const payload = message.payload as ServerMessageMap["FACTION_UPDATE"];
        const updated = factions.map((f) => (f.id === payload.faction.id ? payload.faction : f));
        if (!factions.find((f) => f.id === payload.faction.id)) {
          updated.push(payload.faction);
        }
        set({ factions: updated });
        break;
      }
      case "FACTION_ACTION_RESOLVED": {
        const payload = message.payload as ServerMessageMap["FACTION_ACTION_RESOLVED"];
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: payload.narrative },
          timestamp: new Date().toISOString(),
        });
        // Update action roster
        const updatedActions = factionActions.map((a) => (a.id === payload.action.id ? payload.action : a));
        if (!factionActions.find((a) => a.id === payload.action.id)) {
          updatedActions.unshift(payload.action);
        }
        set({ factionActions: updatedActions });
        break;
      }
      case "FACTION_WAR_DECLARED": {
        const payload = message.payload as ServerMessageMap["FACTION_WAR_DECLARED"];
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `⚔️ ${payload.narrative}` },
          timestamp: new Date().toISOString(),
        });
        break;
      }
      case "FACTION_TREATY_SIGNED": {
        const payload = message.payload as ServerMessageMap["FACTION_TREATY_SIGNED"];
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `📜 ${payload.narrative}` },
          timestamp: new Date().toISOString(),
        });
        break;
      }
      case "FACTION_COLLAPSED": {
        const payload = message.payload as ServerMessageMap["FACTION_COLLAPSED"];
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `🏚️ ${payload.narrative}` },
          timestamp: new Date().toISOString(),
        });
        const updated = factions.map((f) => (f.id === payload.faction_id ? { ...f, collapsed: true } : f));
        set({ factions: updated });
        break;
      }
      case "FACTION_VICTORY": {
        const payload = message.payload as ServerMessageMap["FACTION_VICTORY"];
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `👑 ${payload.narrative}` },
          timestamp: new Date().toISOString(),
        });
        const updated = factions.map((f) => (f.id === payload.faction_id ? { ...f, is_victorious: true } : f));
        set({ factions: updated });
        break;
      }
      case "PLAYER_REP_CHANGED": {
        const payload = message.payload as ServerMessageMap["PLAYER_REP_CHANGED"];
        appendEvent({
          id: Math.random().toString(),
          type: "system",
          payload: { text: `👤 ${payload.narrative}` },
          timestamp: new Date().toISOString(),
        });
        const updated = reputations.map((r) =>
          r.character_id === payload.character_id && r.faction_id === payload.faction_id
            ? { ...r, score: payload.score, tier: payload.tier as ReputationTier }
            : r
        );
        set({ reputations: updated });
        break;
      }
    }
  },

  reset: () => set({ ...initialState }),
}));
