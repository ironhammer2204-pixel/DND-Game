import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useGameStore, type LobbyCampaign, type GameOrSystemEvent, type WsStatus } from "../stores/gameStore";
import { API_URL, WS_URL } from "../config";
import type {
  Character,
  CombatEncounter,
  Location,
  Faction,
  FactionRelation,
  PlayerFactionReputation,
  FactionAction,
  Quest,
  Nemesis,
  NPC,
  ServerWSMessage,
  ServerMessageType,
  ServerMessageMap
} from "@dnd/shared";

export interface InventoryRow {
  id: string;
  character_id: string;
  item_id: string;
  quantity: number;
  is_equipped: boolean;
  acquired_at: string;
  name: string;
  type: string;
  description?: string;
  stats: Record<string, string | number | boolean>;
  value_gp: number;
  is_consumable: boolean;
}

export type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d100";

interface CampaignContextValue {
  // Shared States from Store
  activeCampaign: LobbyCampaign | null;
  activeRole: "player" | "dm" | null;
  partyCharacters: Character[];
  myCharacter: Character | null;
  eventLogs: GameOrSystemEvent[];
  activeCombat: CombatEncounter | null;
  ws: WebSocket | null;
  wsStatus: WsStatus;
  locations: Location[];
  activeRoll: ServerMessageMap["DICE_RESULT"] | null;
  factions: Faction[];
  relations: FactionRelation[];
  reputations: PlayerFactionReputation[];
  factionActions: FactionAction[];
  factionEnginePaused: boolean;

  // Local/Async States managed by provider
  inventory: InventoryRow[];
  quests: Quest[];
  nemeses: Nemesis[];
  currentLocationNpcs: NPC[];
  currentLocation: Location | undefined;
  ambushAlert: string | null;
  copyToast: "success" | "fail" | null;
  questsError: string;
  inventoryError: string;

  // Core API Fetch (with Authorization)
  apiFetch: (endpoint: string, options?: RequestInit) => Promise<any>;

  // Callbacks & Actions
  sendChat: (text: string) => void;
  rollDice: (dice: DiceType, modifier: number) => void;
  rollAttribute: (attrName: string, score: number) => void;
  rollSkill: (skillName: string, bonus: number) => void;
  handleTravel: (targetLocationId: string) => void;
  handleToggleCondition: (participantId: string, condition: "poisoned" | "stunned" | "paralysed" | "dodging", action: "add" | "remove") => void;
  handleAllocateStats: (tempAttributes: Record<string, number>) => Promise<void>;
  toggleQuestObjective: (quest: Quest, objectiveIndex: number, completed: boolean) => Promise<void>;
  toggleInventoryEquip: (item: InventoryRow) => Promise<void>;
  dropInventoryItem: (item: InventoryRow) => Promise<void>;
  handleCopyInvite: () => void;
  createCharacter: (name: string, race: string, class_: string) => Promise<void>;
  dismissActiveRoll: () => void;
  setActiveCampaign: (campaign: LobbyCampaign | null, role: "player" | "dm" | null) => void;

  // Derived combat & stats
  derivedAc: number;
  attackBonus: number;
  spellSaveDc: number;
  proficiencyBonus: number;
  dexModifier: number;
  strModifier: number;
  spellcastingModifier: number;
  bountyReputations: PlayerFactionReputation[];
}

const CampaignContext = createContext<CampaignContextValue | undefined>(undefined);

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  const el = document.createElement("textarea");
  el.value = text;
  Object.assign(el.style, { position: "fixed", left: "-9999px", top: "-9999px" });
  document.body.appendChild(el);
  el.focus(); el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  return ok;
}

export const CampaignProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuthStore();
  const {
    activeCampaign, activeRole, partyCharacters, myCharacter, eventLogs,
    ws, wsStatus, setPartyCharacters, setMyCharacter, clearEvents,
    setWs, setWsStatus, handleWsMessage, setActiveCampaign,
    activeCombat, locations, setLocations, activeRoll, dismissActiveRoll,
    factions, relations, reputations, factionActions, factionEnginePaused,
    setFactions, setRelations, setReputations, setFactionActions
  } = useGameStore();

  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [nemeses, setNemeses] = useState<Nemesis[]>([]);
  const [currentLocationNpcs, setCurrentLocationNpcs] = useState<NPC[]>([]);
  const [ambushAlert, setAmbushAlert] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<"success" | "fail" | null>(null);
  const [questsError, setQuestsError] = useState("");
  const [inventoryError, setInventoryError] = useState("");

  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed ${res.status}`);
    return data;
  };

  const fetchPartyCharacters = async (campaignId: string) => {
    try {
      const data = await apiFetch(`/api/characters/campaign/${campaignId}`);
      const chars: Character[] = data.characters ?? [];
      setPartyCharacters(chars);
      const currentCharacter = chars.find((c) => c.user_id === user?.id) ?? null;
      setMyCharacter(currentCharacter);
      if (currentCharacter) {
        void fetchInventory(currentCharacter.id);
      } else {
        setInventory([]);
      }
    } catch (err) {
      console.error("Error fetching party:", err);
    }
  };

  const fetchInventory = async (characterId: string) => {
    try {
      setInventoryError("");
      const data = await apiFetch(`/api/characters/${characterId}/inventory`);
      setInventory(data.inventory ?? []);
    } catch (err) {
      console.error("Error fetching inventory:", err);
      setInventoryError(err instanceof Error ? err.message : "Unable to load inventory");
    }
  };

  const fetchQuests = async (campaignId: string) => {
    try {
      setQuestsError("");
      const data = await apiFetch(`/api/campaigns/${campaignId}/quests`);
      setQuests(data.quests ?? []);
    } catch (err) {
      console.error("Error fetching quests:", err);
      setQuestsError(err instanceof Error ? err.message : "Unable to load quests");
    }
  };

  const fetchNemeses = async (campaignId: string) => {
    try {
      const data = await apiFetch(`/api/campaigns/${campaignId}/nemeses`);
      setNemeses(data.nemeses ?? []);
    } catch (err) {
      console.error("Error fetching nemeses:", err);
    }
  };

  const fetchFactionSystemData = async (campaignId: string) => {
    try {
      const [factionsData, relationsData, reputationsData, actionsData] = await Promise.all([
        apiFetch(`/api/campaigns/${campaignId}/factions`),
        apiFetch(`/api/campaigns/${campaignId}/factions/relations`),
        apiFetch(`/api/campaigns/${campaignId}/factions/reputations`),
        apiFetch(`/api/campaigns/${campaignId}/factions/actions`),
      ]);
      setFactions(factionsData.factions ?? []);
      setRelations(relationsData.relations ?? []);
      setReputations(reputationsData.reputations ?? []);
      setFactionActions(actionsData.actions ?? []);
    } catch (err) {
      console.error("Error fetching faction system data:", err);
    }
  };

  const fetchWorld = async (campaignId: string) => {
    try {
      const data = await apiFetch(`/api/campaigns/${campaignId}/world`);
      if (data.locations) {
        setLocations(data.locations);
      }
    } catch (err) {
      console.error("Error fetching world details:", err);
    }
  };

  // Sound playback for dice rolling
  const playDiceRollSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();

      const createNoiseBurst = (time: number, volume: number, duration: number) => {
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 800;
        filter.Q.value = 1.5;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(volume, time);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.01);

        noiseSource.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);

        noiseSource.start(time);
      };

      const now = ctx.currentTime;
      createNoiseBurst(now, 0.25, 0.12);
      createNoiseBurst(now + 0.18, 0.15, 0.1);
      createNoiseBurst(now + 0.35, 0.08, 0.08);
      createNoiseBurst(now + 0.5, 0.04, 0.06);
    } catch (err) {
      console.error("Web Audio API failed to play sound:", err);
    }
  };

  const currentLocationId = myCharacter
    ? (activeCampaign?.world_state?.character_locations?.[myCharacter.id] || activeCampaign?.world_state?.starting_location_id)
    : activeCampaign?.world_state?.starting_location_id;

  const currentLocation = locations.find((l) => l.id === currentLocationId);

  // Load location NPCs whenever campaign or currentLocation changes
  useEffect(() => {
    const loadNpcs = async () => {
      if (activeCampaign && currentLocationId) {
        try {
          const data = await apiFetch(`/api/campaigns/${activeCampaign.id}/locations/${currentLocationId}/npcs`);
          setCurrentLocationNpcs(data.npcs || []);
        } catch (err) {
          console.error("Error fetching location NPCs:", err);
        }
      } else {
        setCurrentLocationNpcs([]);
      }
    };
    void loadNpcs();
  }, [activeCampaign?.id, currentLocationId, locations]);

  // Dice roll visual handling
  useEffect(() => {
    if (!activeRoll) return;
    playDiceRollSound();
    const timer = setTimeout(() => {
      dismissActiveRoll();
    }, 2000);
    return () => clearTimeout(timer);
  }, [activeRoll, dismissActiveRoll]);

  // WebSocket lifecycle management
  useEffect(() => {
    if (!activeCampaign || !token || !user) return;
    clearEvents();
    const loadTimer = window.setTimeout(() => {
      void fetchPartyCharacters(activeCampaign.id);
      void fetchQuests(activeCampaign.id);
      void fetchNemeses(activeCampaign.id);
      void fetchFactionSystemData(activeCampaign.id);
      void fetchWorld(activeCampaign.id);
    }, 0);
    setWsStatus("connecting");
    const socket = new WebSocket(`${WS_URL}?token=${token}`);

    socket.onopen = () => {
      setWsStatus("connected");
      setWs(socket);
      socket.send(JSON.stringify({ type: "JOIN_CAMPAIGN", payload: { invite_code: activeCampaign.invite_code } }));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerWSMessage<ServerMessageType>;
        handleWsMessage(message, user.id, fetchPartyCharacters);
        if (message.type === "QUEST_UPDATE") {
          const { quest } = message.payload as { quest: Quest };
          setQuests((current) => {
            const existing = current.some((item) => item.id === quest.id);
            return existing
              ? current.map((item) => (item.id === quest.id ? quest : item))
              : [...current, quest];
          });
        }
        if (message.type === "NEMESIS_UPDATE") {
          const { nemesis } = message.payload as { nemesis: Nemesis };
          setNemeses((prev) => {
            const idx = prev.findIndex((n) => n.id === nemesis.id);
            return idx >= 0 ? prev.map((n, i) => (i === idx ? nemesis : n)) : [...prev, nemesis];
          });
        }
        if (message.type === "NEMESIS_AMBUSH") {
          const { message: msg } = message.payload as { message: string };
          setAmbushAlert(msg);
          setTimeout(() => setAmbushAlert(null), 8000);
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };

    socket.onclose = () => {
      setWsStatus("disconnected");
      setWs(null);
    };

    socket.onerror = () => {
      setWsStatus("disconnected");
    };

    return () => {
      window.clearTimeout(loadTimer);
      socket.close();
      setWs(null);
      setWsStatus("disconnected");
    };
  }, [activeCampaign?.id, token]);

  // WS/API Actions
  const sendChat = (text: string) => {
    if (!text.trim() || !ws) return;
    ws.send(JSON.stringify({ type: "CHAT_MESSAGE", payload: { text } }));
  };

  const rollDice = (dice: DiceType, modifier: number) => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "DICE_REQUEST", payload: { dice_type: dice, context: "Quick Roll", modifier } }));
  };

  const rollAttribute = (attrName: string, score: number) => {
    if (!ws || !myCharacter) return;
    ws.send(JSON.stringify({
      type: "DICE_REQUEST",
      payload: {
        dice_type: "d20",
        context: `roll:${attrName.toUpperCase()}`,
        modifier: Math.floor((score - 10) / 2),
      }
    }));
  };

  const rollSkill = (skillName: string, bonus: number) => {
    if (!ws || !myCharacter) return;
    ws.send(JSON.stringify({
      type: "DICE_REQUEST",
      payload: { dice_type: "d20", context: `skill:${skillName}`, modifier: bonus },
    }));
  };

  const handleTravel = (targetLocationId: string) => {
    if (!ws) return;
    ws.send(JSON.stringify({
      type: "ACTION_SUBMIT",
      payload: {
        type: "exploration",
        text: `Travel to destination`,
        target_location_id: targetLocationId
      }
    }));
  };

  const handleToggleCondition = (
    participantId: string,
    condition: "poisoned" | "stunned" | "paralysed" | "dodging",
    action: "add" | "remove"
  ) => {
    if (!ws) return;
    ws.send(JSON.stringify({
      type: "UPDATE_CONDITIONS",
      payload: { participant_id: participantId, condition, action }
    }));
  };

  const handleAllocateStats = async (tempAttributes: Record<string, number>) => {
    if (!myCharacter || !activeCampaign) return;
    try {
      const data = await apiFetch(`/api/characters/${myCharacter.id}/allocate-stats`, {
        method: "POST",
        body: JSON.stringify({ attributes: tempAttributes }),
      });
      setMyCharacter(data.character);
      void fetchPartyCharacters(activeCampaign.id);
    } catch (err) {
      console.error("Error allocating stats:", err);
      throw err;
    }
  };

  const toggleQuestObjective = async (quest: Quest, objectiveIndex: number, completed: boolean) => {
    if (!activeCampaign || activeRole !== "dm") return;
    try {
      const data = await apiFetch(`/api/campaigns/${activeCampaign.id}/quests/${quest.id}/objective`, {
        method: "PATCH",
        body: JSON.stringify({ objective_index: objectiveIndex, completed }),
      });
      const updatedQuest = data.quest as Quest;
      setQuests((current) => current.map((item) => (item.id === updatedQuest.id ? updatedQuest : item)));
    } catch (err) {
      setQuestsError(err instanceof Error ? err.message : "Unable to update quest");
      throw err;
    }
  };

  const toggleInventoryEquip = async (item: InventoryRow) => {
    if (!myCharacter) return;
    try {
      await apiFetch(`/api/characters/${myCharacter.id}/inventory/${item.id}/equip`, {
        method: "PATCH",
        body: JSON.stringify({ is_equipped: !item.is_equipped }),
      });
      void fetchInventory(myCharacter.id);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "Failed to update equipment");
      throw err;
    }
  };

  const dropInventoryItem = async (item: InventoryRow) => {
    if (!myCharacter) return;
    try {
      await apiFetch(`/api/characters/${myCharacter.id}/inventory/${item.id}`, { method: "DELETE" });
      void fetchInventory(myCharacter.id);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "Failed to drop item");
      throw err;
    }
  };

  const handleCopyInvite = async () => {
    if (!activeCampaign) return;
    const ok = await copyToClipboard(activeCampaign.invite_code);
    setCopyToast(ok ? "success" : "fail");
    setTimeout(() => setCopyToast(null), 2500);
  };

  const createCharacter = async (name: string, race: string, class_: string) => {
    if (!name.trim() || !activeCampaign) return;
    try {
      const data = await apiFetch("/api/characters", {
        method: "POST",
        body: JSON.stringify({ campaign_id: activeCampaign.id, name, race, class: class_ }),
      });
      setMyCharacter(data.character as Character);
      void fetchInventory((data.character as Character).id);
      void fetchPartyCharacters(activeCampaign.id);
      ws?.send(JSON.stringify({ type: "JOIN_CAMPAIGN", payload: { invite_code: activeCampaign.invite_code } }));
    } catch (err) {
      console.error("Failed to create character:", err);
      throw err;
    }
  };

  // Derived Calculations
  const equippedItems = inventory.filter((item) => item.is_equipped);
  const equippedArmor = equippedItems.find((item) => item.type === "armor" && item.stats.ac_base);
  const shieldBonus = equippedItems
    .filter((item) => item.type === "armor" && item.stats.ac_bonus)
    .reduce((total, item) => total + Number(item.stats.ac_bonus || 0), 0);
  const dexModifier = myCharacter ? Math.floor((Number(myCharacter.attributes.dex) - 10) / 2) : 0;
  const strModifier = myCharacter ? Math.floor((Number(myCharacter.attributes.str) - 10) / 2) : 0;
  const armorBase = equippedArmor ? Number(equippedArmor.stats.ac_base) : 10;
  const allowsDexBonus = equippedArmor ? Boolean(equippedArmor.stats.dex_bonus) : true;
  const derivedAc = armorBase + (allowsDexBonus ? dexModifier : 0) + shieldBonus;
  const proficiencyBonus = myCharacter ? 2 + Math.floor((myCharacter.level - 1) / 4) : 2;
  const attackBonus = proficiencyBonus + Math.max(strModifier, dexModifier);

  const spellcastingAttributeByClass: Record<string, keyof Character["attributes"]> = {
    Bard: "cha",
    Cleric: "wis",
    Druid: "wis",
    Paladin: "cha",
    Ranger: "wis",
    Sorcerer: "cha",
    Warlock: "cha",
    Wizard: "int",
  };
  const spellcastingAttribute = myCharacter ? spellcastingAttributeByClass[myCharacter.class] : undefined;
  const spellcastingModifier = myCharacter && spellcastingAttribute
    ? Math.floor((Number(myCharacter.attributes[spellcastingAttribute]) - 10) / 2)
    : 0;
  const spellSaveDc = 8 + proficiencyBonus + spellcastingModifier;

  const bountyReputations = myCharacter
    ? reputations.filter(
        (r) =>
          r.character_id === myCharacter.id &&
          (r.tier === "wanted" || r.tier === "hunted")
      )
    : [];

  return (
    <CampaignContext.Provider
      value={{
        activeCampaign, activeRole, partyCharacters, myCharacter, eventLogs,
        ws, wsStatus, locations, activeRoll, factions, relations, reputations,
        factionActions, factionEnginePaused, inventory, quests, nemeses,
        currentLocationNpcs, currentLocation, ambushAlert, copyToast,
        questsError, inventoryError, apiFetch, sendChat, rollDice,
        rollAttribute, rollSkill, handleTravel, handleToggleCondition,
        handleAllocateStats, toggleQuestObjective, toggleInventoryEquip,
        dropInventoryItem, handleCopyInvite, createCharacter,
        dismissActiveRoll, setActiveCampaign, activeCombat,
        derivedAc, attackBonus, spellSaveDc, proficiencyBonus,
        dexModifier, strModifier, spellcastingModifier, bountyReputations
      }}
    >
      {children}
    </CampaignContext.Provider>
  );
};

export const useCampaign = () => {
  const context = useContext(CampaignContext);
  if (!context) {
    throw new Error("useCampaign must be used within a CampaignProvider");
  }
  return context;
};
