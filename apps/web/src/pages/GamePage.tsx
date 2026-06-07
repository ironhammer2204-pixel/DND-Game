import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useGameStore } from "../stores/gameStore";
import { WsReconnectBanner } from "../components/WsReconnectBanner";
import { DicePanel } from "../components/DicePanel";
import { NemesisGallery } from "../components/NemesisGallery";
import { FactionControlRoom } from "../components/FactionControlRoom";
import { EncyclopediaPanel } from "../components/EncyclopediaPanel";
import { BalanceDashboard } from "../components/BalanceDashboard";
import { RACES, CLASSES } from "@dnd/shared";
import { API_URL, WS_URL } from "../config";
import type { Character, DiceType, Quest, Nemesis, ServerWSMessage, ServerMessageType, NPC } from "@dnd/shared";
import type React from "react";


interface ChatPayload { sender_name: string; text: string; }
interface ExplorationPayload {
  roller_name: string; dice_type: string;
  raw: number; modifier: number; final: number; context: string;
}
interface InventoryRow {
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

const CLASS_STARTING_STATS: Record<string, { attributes: Record<string, number>; hp: number }> = {
  Barbarian: { attributes: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 10 }, hp: 14 },
  Bard: { attributes: { str: 8, dex: 14, con: 12, int: 10, wis: 12, cha: 15 }, hp: 9 },
  Cleric: { attributes: { str: 14, dex: 8, con: 12, int: 10, wis: 15, cha: 10 }, hp: 9 },
  Druid: { attributes: { str: 10, dex: 12, con: 13, int: 10, wis: 15, cha: 8 }, hp: 9 },
  Fighter: { attributes: { str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 8 }, hp: 12 },
  Monk: { attributes: { str: 10, dex: 15, con: 12, int: 10, wis: 14, cha: 8 }, hp: 9 },
  Paladin: { attributes: { str: 15, dex: 8, con: 13, int: 10, wis: 12, cha: 14 }, hp: 11 },
  Ranger: { attributes: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 }, hp: 11 },
  Rogue: { attributes: { str: 8, dex: 15, con: 12, int: 13, wis: 10, cha: 14 }, hp: 9 },
  Sorcerer: { attributes: { str: 8, dex: 13, con: 14, int: 10, wis: 10, cha: 15 }, hp: 8 },
  Warlock: { attributes: { str: 8, dex: 13, con: 14, int: 10, wis: 10, cha: 15 }, hp: 10 },
  Wizard: { attributes: { str: 8, dex: 13, con: 14, int: 15, wis: 10, cha: 10 }, hp: 8 },
};

const getAvailableStatPoints = (char: Character) => {
  const defaults = CLASS_STARTING_STATS[char.class];
  if (!defaults) return 0;
  const startingSum = Object.values(defaults.attributes).reduce((s, v) => s + v, 0);
  const currentSum = Object.values(char.attributes).reduce((s, v) => s + v, 0);
  const allowed = startingSum + 2 * (char.level - 1);
  return Math.max(0, allowed - currentSum);
};

export function GamePage() {
  const { token, user, clearSession } = useAuthStore();
  const {
    activeCampaign, activeRole, partyCharacters, myCharacter, eventLogs,
    ws, wsStatus, setPartyCharacters, setMyCharacter, clearEvents,
    setWs, setWsStatus, handleWsMessage, setActiveCampaign,
    activeCombat, locations, setLocations, activeRoll, dismissActiveRoll,
    factions, reputations,
    setFactions, setRelations, setReputations, setFactionActions
  } = useGameStore();

  const [showFactions, setShowFactions] = useState(false);

  const [chatMessage, setChatMessage] = useState("");
  const [charName, setCharName] = useState("");
  const [charRace, setCharRace] = useState<string>(RACES[0]);
  const [charClass, setCharClass] = useState<string>(CLASSES[0]);
  const [charError, setCharError] = useState("");
  const [copyToast, setCopyToast] = useState<"success" | "fail" | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [inventoryError, setInventoryError] = useState("");
  const [quests, setQuests] = useState<Quest[]>([]);
  const [questError, setQuestError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // New location and ASI states
  const [currentLocationNpcs, setCurrentLocationNpcs] = useState<NPC[]>([]);
  const [showNpcPopover, setShowNpcPopover] = useState(false);
  const [showAsiModal, setShowAsiModal] = useState(false);
  const [tempAttributes, setTempAttributes] = useState<Record<string, number>>({});

  // Nemesis system state
  const [nemeses, setNemeses] = useState<Nemesis[]>([]);
  const [ambushAlert, setAmbushAlert] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "nemesis" | "encyclopedia" | "balance">("chat");

  // Combat spawning local states
  const [selectedMonster, setSelectedMonster] = useState("goblin");
  const [monsterCount, setMonsterCount] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState("");


  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
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
    } catch (err) { console.error("Error fetching party:", err); }
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
      setQuestError("");
      const data = await apiFetch(`/api/campaigns/${campaignId}/quests`);
      setQuests(data.quests ?? []);
    } catch (err) {
      console.error("Error fetching quests:", err);
      setQuestError(err instanceof Error ? err.message : "Unable to load quests");
    }
  };

  const fetchNemeses = async (campaignId: string) => {
    try {
      const data = await apiFetch(`/api/campaigns/${campaignId}/nemeses`);
      setNemeses(data.nemeses ?? []);
    } catch (err) { console.error("Error fetching nemeses:", err); }
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

  const handleToggleCondition = (participantId: string, condition: "poisoned" | "stunned" | "paralysed" | "dodging", action: "add" | "remove") => {
    if (!ws) return;
    ws.send(JSON.stringify({
      type: "UPDATE_CONDITIONS",
      payload: { participant_id: participantId, condition, action }
    }));
  };

  const handleAllocateStats = async () => {
    if (!myCharacter || !activeCampaign) return;
    try {
      const data = await apiFetch(`/api/characters/${myCharacter.id}/allocate-stats`, {
        method: "POST",
        body: JSON.stringify({ attributes: tempAttributes }),
      });
      setMyCharacter(data.character);
      setShowAsiModal(false);
      void fetchPartyCharacters(activeCampaign.id);
    } catch (err) {
      console.error("Error allocating stats:", err);
    }
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign?.id, currentLocationId, locations]);

  useEffect(() => {
    if (!activeRoll) return;
    playDiceRollSound();
    const timer = setTimeout(() => {
      dismissActiveRoll();
    }, 2000);
    return () => clearTimeout(timer);
  }, [activeRoll, dismissActiveRoll]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLogs]);

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

      } catch (err) { console.error("WS parse error:", err); }
    };
    socket.onclose = () => { setWsStatus("disconnected"); setWs(null); };
    socket.onerror = () => { setWsStatus("disconnected"); };

    return () => { window.clearTimeout(loadTimer); socket.close(); setWs(null); setWsStatus("disconnected"); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign?.id, token]);

  const sendChat = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!chatMessage.trim() || !ws) return;
    ws.send(JSON.stringify({ type: "CHAT_MESSAGE", payload: { text: chatMessage } }));
    setChatMessage("");
  };

  const rollDice = (dice: DiceType, modifier: number) => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "DICE_REQUEST", payload: { dice_type: dice, context: "Quick Roll", modifier } }));
  };

  const rollAttribute = (attrName: string, score: number) => {
    if (!ws || !myCharacter) return;
    ws.send(JSON.stringify({ type: "DICE_REQUEST", payload: {
      dice_type: "d20", context: `roll:${attrName.toUpperCase()}`, modifier: Math.floor((score - 10) / 2),
    } }));
  };

  const handleCreateCharacter = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCharError("");
    if (!charName.trim() || !activeCampaign) return;
    try {
      const data = await apiFetch("/api/characters", {
        method: "POST",
        body: JSON.stringify({ campaign_id: activeCampaign.id, name: charName, race: charRace, class: charClass }),
      });
      setCharName("");
      setMyCharacter(data.character as Character);
      void fetchInventory((data.character as Character).id);
      void fetchPartyCharacters(activeCampaign.id);
      ws?.send(JSON.stringify({ type: "JOIN_CAMPAIGN", payload: { invite_code: activeCampaign.invite_code } }));
    } catch (err) { setCharError(err instanceof Error ? err.message : "Failed to create character"); }
  };

  const rollSkill = (skillName: string, bonus: number) => {
    if (!ws || !myCharacter) return;
    ws.send(JSON.stringify({
      type: "DICE_REQUEST",
      payload: { dice_type: "d20", context: `skill:${skillName}`, modifier: bonus },
    }));
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
      setQuestError(err instanceof Error ? err.message : "Unable to update quest");
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
    }
  };

  const dropInventoryItem = async (item: InventoryRow) => {
    if (!myCharacter) return;
    try {
      await apiFetch(`/api/characters/${myCharacter.id}/inventory/${item.id}`, { method: "DELETE" });
      void fetchInventory(myCharacter.id);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "Failed to drop item");
    }
  };

  const handleCopyInvite = async () => {
    if (!activeCampaign) return;
    const ok = await copyToClipboard(activeCampaign.invite_code);
    setCopyToast(ok ? "success" : "fail");
    setTimeout(() => setCopyToast(null), 2500);
  };

  if (!activeCampaign) return null;

  const equippedItems = inventory.filter((item) => item.is_equipped);
  const equippedArmor = equippedItems.find((item) => item.type === "armor" && item.stats.ac_base);
  const shieldBonus = equippedItems
    .filter((item) => item.type === "armor" && item.stats.ac_bonus)
    .reduce((total, item) => total + Number(item.stats.ac_bonus || 0), 0);
  const dexModifier = myCharacter ? Math.floor((Number(myCharacter.attributes.dex) - 10) / 2) : 0;
  const armorBase = equippedArmor ? Number(equippedArmor.stats.ac_base) : 10;
  const allowsDexBonus = equippedArmor ? Boolean(equippedArmor.stats.dex_bonus) : true;
  const derivedAc = armorBase + (allowsDexBonus ? dexModifier : 0) + shieldBonus;
  const proficiencyBonus = myCharacter ? 2 + Math.floor((myCharacter.level - 1) / 4) : 2;
  const strModifier = myCharacter ? Math.floor((Number(myCharacter.attributes.str) - 10) / 2) : 0;
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
  const activeQuests = quests.filter((quest) => quest.status === "active");
  const completedQuests = quests.filter((quest) => quest.status === "complete");

  const bountyReputations = myCharacter
    ? reputations.filter(
        (r) =>
          r.character_id === myCharacter.id &&
          (r.tier === "wanted" || r.tier === "hunted")
      )
    : [];

  return (
    <div className="game-page">
      <WsReconnectBanner status={wsStatus} />

      <header className="game-header">
        <div className="game-header__left">
          <button className="btn btn-ghost game-header__back-btn" onClick={() => setActiveCampaign(null, null)}>
            &#x2190; Lobby
          </button>
          <div className="game-header__campaign">
            <h1 className="game-header__campaign-name">{activeCampaign.name}</h1>
          </div>
          <button className="game-invite-pill" onClick={handleCopyInvite}
            title="Click to copy invite code" aria-label={`Copy invite code ${activeCampaign.invite_code}`}>
            <span className="game-invite-pill__label">Invite:</span>
            <code className="game-invite-pill__code">{activeCampaign.invite_code}</code>
            <span className="game-invite-pill__icon" aria-hidden="true">&#x1F4CB;</span>
          </button>
          {copyToast && (
            <div className={`copy-toast copy-toast--${copyToast}`} role="status" aria-live="polite">
              {copyToast === "success" ? "Copied!" : `Copy failed - code: ${activeCampaign.invite_code}`}
            </div>
          )}
        </div>
        <div className="game-header__right">
          <span className={`role-badge role-badge--${activeRole}`}>
            {activeRole === "dm" ? "DM" : "Player"}
          </span>
          <span className="game-header__username">{user?.username}</span>
          <button className="btn btn-danger" onClick={clearSession}>Logout</button>
        </div>
      </header>

      <div className="game-layout">
        <aside className="sidebar-left" aria-label="Campaign party">
          <div className="sidebar-section-title">Campaign Party</div>
          <div className="member-list" role="list">
            {partyCharacters.map((char) => {
              const isMe = char.user_id === user?.id;
              const hpPct = Math.max(0, (char.hp_current / char.hp_max) * 100);
              return (
                <div key={char.id} className={`member-card${isMe ? " member-card--me" : ""}`} role="listitem">
                  <div className="member-card__header">
                    <div className="member-card__avatar" aria-hidden="true">{char.name.charAt(0)}</div>
                    <div className="member-card__info">
                      <span className="member-card__name">{char.name}</span>
                      <span className="member-card__subtitle">{char.race} {char.class}</span>
                    </div>
                    <div className="member-card__level">Lv.{char.level}</div>
                  </div>
                  <div className="member-card__hp-bar">
                    <div className="member-card__hp-fill" style={{ width: `${hpPct}%` }}
                      role="progressbar" aria-valuenow={char.hp_current} aria-valuemin={0} aria-valuemax={char.hp_max}
                      aria-label={`${char.name} HP`} />
                  </div>
                  <div className="member-card__hp-label">{char.hp_current} / {char.hp_max} HP</div>
                </div>
              );
            })}
            {partyCharacters.length === 0 && (
              <div className="member-list__empty">No adventurers have joined yet...</div>
            )}
          </div>

          <div className="rumors-feed-section" style={{ marginTop: "20px" }}>
            <div className="sidebar-section-title">Rumors & World Events</div>
            <div className="rumors-list" style={{
              maxHeight: "150px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              padding: "4px",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "4px",
              border: "1px solid var(--border-subtle)"
            }}>
              {eventLogs
                .filter((log) => log.type === "system")
                .slice()
                .reverse()
                .map((log) => (
                  <div key={log.id} className="rumor-item" style={{
                    fontSize: "0.8rem",
                    color: "var(--text-light)",
                    borderBottom: "1px solid var(--border-subtle)",
                    paddingBottom: "6px"
                  }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block" }}>
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span>{log.payload.text}</span>
                  </div>
                ))}
              {eventLogs.filter((log) => log.type === "system").length === 0 && (
                <div className="member-list__empty">No rumors or events yet.</div>
              )}
            </div>
          </div>

          <div className="quest-log">
            <div className="sidebar-section-title">Quest Log</div>
            {questError && <div className="auth-message auth-message--error" role="alert">{questError}</div>}
            {activeQuests.length === 0 && completedQuests.length === 0 ? (
              <div className="member-list__empty">No quests tracked yet.</div>
            ) : (
              <>
                {activeQuests.map((quest) => (
                  <div key={quest.id} className="quest-card">
                    <div className="quest-card__header">
                      <span className="quest-card__title">{quest.title}</span>
                      <span className="quest-card__type">{quest.type}</span>
                    </div>
                    {quest.description && <p className="quest-card__desc">{quest.description}</p>}
                    <div className="quest-objectives">
                      {quest.objectives.map((objective, index) => (
                        <label key={`${quest.id}-${index}`} className="quest-objective">
                          <input
                            type="checkbox"
                            checked={objective.completed}
                            disabled={activeRole !== "dm"}
                            onChange={(event) => void toggleQuestObjective(quest, index, event.target.checked)}
                          />
                          <span>{objective.text}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {completedQuests.length > 0 && (
                  <div className="quest-complete-list">
                    <div className="sidebar-section-title">Completed</div>
                    {completedQuests.map((quest) => (
                      <div key={quest.id} className="quest-card quest-card--complete">
                        <span className="quest-card__title">{quest.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="location-control-section" style={{ marginTop: "20px" }}>
            <div className="sidebar-section-title">Location Dominion & Laws</div>
            <div className="location-list" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {locations.map((loc) => {
                const state = typeof loc.state === "string" ? JSON.parse(loc.state) : (loc.state || {});
                const controllingFactionId = state.controlling_faction_id;
                const faction = controllingFactionId ? factions.find((f) => f.id === controllingFactionId) : null;
                
                const isFactionHidden = faction?.is_hidden && activeRole !== "dm";
                const factionNameDisplay = isFactionHidden ? "??? (Hidden Faction)" : (faction ? faction.name : "None / Unaligned");
                
                const lawLabel = state.law ? state.law.replace(/_/g, " ").toUpperCase() : "ANARCHY";
                const taxLabel = state.tax_percent !== undefined ? `${state.tax_percent}%` : "0%";
                const patrolLabel = state.patrol_level ? state.patrol_level.toUpperCase() : "NONE";

                return (
                  <div key={loc.id} className="location-card" style={{
                    padding: "10px",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "6px"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                      <span style={{ fontSize: "0.9rem", fontWeight: "600", color: "var(--text-white)" }}>{loc.name}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{loc.type}</span>
                    </div>
                    {loc.description && <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 8px 0" }}>{loc.description}</p>}
                    
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "0.75rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px" }}>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Dominion: </span>
                        <strong style={{ color: faction && !isFactionHidden ? "var(--accent-gold)" : "var(--text-muted)" }}>
                          {factionNameDisplay}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Patrols: </span>
                        <strong>{patrolLabel}</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Laws: </span>
                        <strong>{lawLabel}</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Tax: </span>
                        <strong>{taxLabel}</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
              {locations.length === 0 && (
                <div className="member-list__empty">No locations discovered yet.</div>
              )}
            </div>
          </div>
        </aside>

        <main className="chat-column" aria-label="Game events and chat">
          {ambushAlert && (
            <div className="ambush-alert" role="alert">
              <span className="ambush-alert__icon">⚠️</span>
              <span>{ambushAlert}</span>
              <button className="ambush-alert__close" onClick={() => setAmbushAlert(null)}>✕</button>
            </div>
          )}

          {bountyReputations.map((rep) => {
            const faction = factions.find((f) => f.id === rep.faction_id);
            const isFactionHidden = faction?.is_hidden && activeRole !== "dm";
            const factionName = faction && !isFactionHidden ? faction.name : "Unknown Faction";
            const isHunted = rep.tier === "hunted";
            return (
              <div key={rep.id} className={`bounty-banner bounty-banner--${rep.tier}`} style={{
                background: isHunted ? "rgba(127, 29, 29, 0.9)" : "rgba(239, 68, 68, 0.9)",
                color: "#fff",
                padding: "10px 14px",
                borderRadius: "6px",
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                border: isHunted ? "1px solid #ff0000" : "1px solid #ef4444",
                boxShadow: "0 0 10px rgba(239,68,68,0.3)",
              }}>
                <span style={{ fontSize: "1.2rem" }}>🚨</span>
                <div style={{ flex: 1 }}>
                  <strong style={{ textTransform: "uppercase" }}>BOUNTY ACTIVE: {rep.tier}!</strong>
                  <div style={{ fontSize: "0.85rem", opacity: 0.9 }}>
                    You are {rep.tier} by <strong>{factionName}</strong>. Reputation Score: {rep.score}.
                    {isHunted ? " Nemesis assassins are actively hunting you!" : " Watch your step in their territory."}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Location HUD */}
          {currentLocation ? (
            <div className="location-hud">
              <div className="location-hud__main">
                <div className="location-hud__details">
                  <div className="location-hud__type-row">
                    <span className={`location-hud__type-tag location-hud__type-tag--${currentLocation.type}`}>{currentLocation.type}</span>
                    <h3 className="location-hud__name">{currentLocation.name}</h3>
                  </div>
                  <p className="location-hud__desc">{currentLocation.description}</p>
                </div>

                <div className="location-hud__npc-section">
                  <button 
                    className="location-hud__npc-badge" 
                    onClick={() => setShowNpcPopover(!showNpcPopover)}
                    title="View present NPCs"
                  >
                    👥 NPCs: {currentLocationNpcs.length}
                  </button>
                  {showNpcPopover && (
                    <div className="npc-popover">
                      <div className="npc-popover__header">
                        <h4>NPCs Present</h4>
                        <button className="npc-popover__close" onClick={() => setShowNpcPopover(false)}>✕</button>
                      </div>
                      <div className="npc-popover__list">
                        {currentLocationNpcs.length === 0 ? (
                          <div className="npc-popover__empty">No NPCs here.</div>
                        ) : (
                          currentLocationNpcs.map((npc) => {
                            let relStatus = "Neutral";
                            const score = npc.relationship_score || 0;
                            if (score > 80) relStatus = "Trusted";
                            else if (score > 30) relStatus = "Friendly";
                            else if (score < -30) relStatus = "Hostile";

                            return (
                              <div key={npc.id} className="npc-popover__item" style={{ marginBottom: "0.5rem" }}>
                                <div>
                                  <span className="npc-popover__name" style={{ fontWeight: "bold" }}>{npc.name}</span>
                                  {npc.role && <span className="npc-popover__role" style={{ color: "#888", marginLeft: "4px" }}>({npc.role})</span>}
                                </div>
                                <div style={{ fontSize: "0.85rem", marginTop: "2px" }}>
                                  <strong>Relationship:</strong> {relStatus} ({score})
                                </div>
                                <div style={{ fontSize: "0.85rem", fontStyle: "italic", color: "#bbb", marginTop: "2px" }}>
                                  "{npc.party_perception || "Neutral"}"
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="location-hud__connections">
                <span className="location-hud__connections-title">Travel paths:</span>
                <div className="location-hud__connections-list">
                  {currentLocation.connected_locations.map((connId) => {
                    const connLoc = locations.find((l) => l.id === connId);
                    if (!connLoc) return null;
                    return (
                      <button
                        key={connId}
                        className="btn btn-ghost location-hud__travel-btn"
                        onClick={() => handleTravel(connId)}
                        disabled={wsStatus !== "connected"}
                      >
                        📍 {connLoc.name}
                      </button>
                    );
                  })}
                  {currentLocation.connected_locations.length === 0 && (
                    <span className="location-hud__no-connections">No connected paths found.</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="location-hud location-hud--empty">
              <span>Loading world travel details...</span>
            </div>
          )}

          <div className="chat-tab-bar">
            <button
              className={`chat-tab-btn ${activeTab === "chat" ? "chat-tab-btn--active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >💬 Events</button>
            <button
              className={`chat-tab-btn ${activeTab === "nemesis" ? "chat-tab-btn--active" : ""}`}
              onClick={() => setActiveTab("nemesis")}
            >
              ⚔️ Nemeses
              {nemeses.filter((n) => n.status === "active" || n.status === "ambushing").length > 0 && (
                <span className="nemesis-tab-count">
                  {nemeses.filter((n) => n.status === "active" || n.status === "ambushing").length}
                </span>
              )}
            </button>
            <button
              className={`chat-tab-btn ${activeTab === "encyclopedia" ? "chat-tab-btn--active" : ""}`}
              onClick={() => setActiveTab("encyclopedia")}
            >📚 Encyclopedia</button>
            {activeRole === "dm" && (
              <button
                className={`chat-tab-btn ${activeTab === "balance" ? "chat-tab-btn--active" : ""}`}
                onClick={() => setActiveTab("balance")}
              >⚖️ Balance</button>
            )}
          </div>

          {activeTab === "nemesis" ? (
            <div className="nemesis-gallery-wrapper">
              <NemesisGallery
                campaignId={activeCampaign.id}
                token={token ?? ""}
                nemeses={nemeses}
                factions={factions}
                isDM={activeRole === "dm"}
                onUpdate={() => {
                  void fetchNemeses(activeCampaign.id);
                  void fetchFactionSystemData(activeCampaign.id);
                }}
              />
            </div>
          ) : null}

          {activeTab === "encyclopedia" ? (
            <div className="encyclopedia-tab-wrapper" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <EncyclopediaPanel
                campaignId={activeCampaign.id}
                token={token ?? ""}
                isDM={activeRole === "dm"}
                characterId={myCharacter?.id}
              />
            </div>
          ) : null}

          {activeTab === "balance" && activeRole === "dm" ? (
            <div className="balance-tab-wrapper" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <BalanceDashboard
                campaignId={activeCampaign.id}
                token={token ?? ""}
              />
            </div>
          ) : null}

          {activeTab === "chat" && activeCombat && (
            <div className="combat-tracker-panel animate-fade-in" style={{ padding: "12px", borderBottom: "1px solid var(--border-dark)", background: "rgba(10, 11, 20, 0.7)", backdropFilter: "blur(8px)" }}>
              <div className="combat-tracker-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div className="combat-tracker-title" style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-cinzel)", fontWeight: "bold", color: "var(--accent-gold)" }}>
                  <span className="combat-icon">⚔️</span>
                  <span>Combat &mdash; Round {activeCombat.round_number}</span>
                </div>
                <div className="combat-active-turn" style={{ fontSize: "0.85rem", color: "var(--text-light)" }}>
                  Active Turn: <span className="active-name" style={{ color: "var(--accent-gold)", fontWeight: "bold" }}>{activeCombat.turn_order[activeCombat.current_turn_index]?.name}</span>
                </div>
              </div>

              {/* Participant List */}
              <div className="combat-participants-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "8px", marginBottom: "12px", maxHeight: "150px", overflowY: "auto", padding: "4px" }}>
                {activeCombat.turn_order.map((p, idx) => {
                  const isCurrent = idx === activeCombat.current_turn_index;
                  const hpPct = Math.max(0, (p.hp_current / p.hp_max) * 100);
                  const isDead = p.hp_current <= 0;
                  const isUnconscious = isDead && p.type === "player" && !p.conditions.includes("stable");
                  const isStable = p.conditions.includes("stable");

                  return (
                    <div key={p.id} className={`combat-p-card ${isCurrent ? 'combat-p-card--current' : ''} ${isDead ? 'combat-p-card--dead' : ''}`} style={{
                      padding: "8px",
                      borderRadius: "6px",
                      background: isCurrent ? "rgba(184, 134, 11, 0.15)" : "rgba(255, 255, 255, 0.03)",
                      border: isCurrent ? "1px solid var(--accent-gold)" : "1px solid var(--border-dark)",
                      opacity: isDead ? 0.6 : 1,
                      transition: "all 0.3s ease"
                    }}>
                      <div className="combat-p-card__header" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", fontWeight: "600", marginBottom: "4px" }}>
                        <span className="combat-p-card__name" style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "100px", color: isCurrent ? "var(--accent-gold)" : "var(--text-light)" }}>
                          {isCurrent && <span className="current-arrow">👉 </span>}
                          {p.name}
                        </span>
                        <span className="combat-p-card__hp" style={{ color: "var(--text-dim)" }}>{p.hp_current}/{p.hp_max}</span>
                      </div>
                      <div className="combat-p-card__hp-bar" style={{ height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden", marginBottom: "4px" }}>
                        <div className="combat-p-card__hp-fill" style={{ width: `${hpPct}%`, height: "100%", transition: "width 0.3s ease", background: p.hp_current / p.hp_max > 0.5 ? "var(--success-green)" : p.hp_current / p.hp_max > 0.25 ? "var(--accent-gold)" : "var(--danger-red)" }} />
                      </div>
                      <div className="combat-p-card__details" style={{ display: "flex", flexWrap: "wrap", gap: "4px", fontSize: "0.7rem", alignItems: "center" }}>
                        <span className="combat-p-card__stat" style={{ color: "var(--text-dim)" }}>AC: {p.ac}</span>
                        {p.conditions.map(c => (
                          <span key={c} className={`condition-badge condition-badge--${c}`} style={{ background: "rgba(184, 134, 11, 0.2)", border: "1px solid var(--accent-gold)", borderRadius: "3px", padding: "1px 3px" }}>{c}</span>
                        ))}
                        {isUnconscious && (
                          <div className="combat-p-card__death-saves" style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                            <span style={{ color: "var(--danger-red)" }}>💀</span>
                            <span style={{ color: "var(--success-green)" }}>✓</span>{p.death_save_successes}
                            <span style={{ color: "var(--danger-red)", marginLeft: "4px" }}>✗</span>{p.death_save_failures}
                          </div>
                        )}
                        {isStable && <span className="stable-badge" style={{ color: "var(--success-green)" }}>Stable</span>}
                      </div>

                      {/* DM Condition Manager */}
                      {activeRole === "dm" && (
                        <div className="combat-p-card__dm-conditions" style={{ marginTop: "6px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "4px", display: "flex", gap: "2px", flexWrap: "wrap" }}>
                          {["poisoned", "stunned", "paralysed", "dodging"].map((cond) => {
                            const hasCond = p.conditions.includes(cond);
                            return (
                              <button
                                key={cond}
                                onClick={() => handleToggleCondition(p.id, cond as "poisoned" | "stunned" | "paralysed" | "dodging", hasCond ? "remove" : "add")}
                                style={{
                                  fontSize: "0.65rem",
                                  padding: "2px 4px",
                                  background: hasCond ? "var(--accent-gold)" : "rgba(255,255,255,0.05)",
                                  color: hasCond ? "#000" : "var(--text-dim)",
                                  border: "1px solid rgba(255,255,255,0.1)",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  transition: "all 0.2s"
                                }}
                              >
                                {cond.substring(0, 3)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action Console */}
              {(() => {
                const activeParticipant = activeCombat.turn_order[activeCombat.current_turn_index];
                if (!activeParticipant) return null;

                const isMyTurn = myCharacter && activeParticipant.id === myCharacter.id;
                const isEnemyTurn = activeParticipant.type === "enemy";

                if (isEnemyTurn) {
                  return (
                    <div className="combat-action-console combat-action-console--enemy" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "6px", fontSize: "0.85rem", color: "var(--text-dim)" }}>
                      <span className="loading-spinner-small" style={{ width: "12px", height: "12px", border: "2px solid var(--text-dim)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                      <span>{activeParticipant.name} is preparing to strike...</span>
                    </div>
                  );
                }

                if (isMyTurn) {
                  const isDowned = myCharacter.hp_current === 0 && !activeParticipant.conditions.includes("stable");
                  if (isDowned) {
                    return (
                      <div className="combat-action-console combat-action-console--downed" style={{ padding: "8px", background: "rgba(139,0,0,0.1)", border: "1px solid var(--danger-red)", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.85rem", color: "var(--danger-red)", fontWeight: "600" }}>⚠️ Unconscious! Roll Death Save.</span>
                        <button onClick={() => ws?.send(JSON.stringify({ type: "DEATH_SAVE_ROLL", payload: {} }))} className="btn btn-danger" style={{ padding: "4px 12px" }}>
                          💀 Roll Death Save
                        </button>
                      </div>
                    );
                  }

                  const enemies = activeCombat.turn_order.filter(p => p.type === "enemy" && p.hp_current > 0);
                  const currentTargetId = selectedTarget && enemies.some(e => e.id === selectedTarget)
                    ? selectedTarget
                    : (enemies[0]?.id || "");

                  return (
                    <div className="combat-action-console" style={{ padding: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-dark)", borderRadius: "6px" }}>
                      <div className="action-console-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div className="form-group flex-grow" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <label htmlFor="combat-target-select" style={{ fontSize: "0.8rem", color: "var(--text-dim)", whiteSpace: "nowrap" }}>Target:</label>
                          <select id="combat-target-select" className="input-field" value={currentTargetId} onChange={e => setSelectedTarget(e.target.value)} style={{ padding: "4px 8px" }}>
                            {enemies.map(e => (
                              <option key={e.id} value={e.id}>{e.name} ({e.hp_current}/{e.hp_max} HP)</option>
                            ))}
                            {enemies.length === 0 && <option value="">No targets left</option>}
                          </select>
                        </div>
                        <div className="action-buttons" style={{ display: "flex", gap: "6px" }}>
                          <button onClick={() => ws?.send(JSON.stringify({
                            type: "COMBAT_ACTION",
                            payload: { action_type: "attack", target_id: currentTargetId }
                          }))} className="btn btn-primary" style={{ padding: "4px 12px" }} disabled={enemies.length === 0}>
                            ⚔️ Attack
                          </button>
                          <button onClick={() => ws?.send(JSON.stringify({
                            type: "COMBAT_ACTION",
                            payload: { action_type: "dodge" }
                          }))} className="btn btn-ghost" style={{ padding: "4px 12px" }}>
                            🛡️ Dodge
                          </button>
                          <button onClick={() => ws?.send(JSON.stringify({
                            type: "COMBAT_ACTION",
                            payload: { action_type: "end_turn" }
                          }))} className="btn btn-secondary" style={{ padding: "4px 12px" }}>
                            End Turn
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="combat-action-console combat-action-console--waiting" style={{ padding: "8px", background: "rgba(0,0,0,0.1)", borderRadius: "6px", fontSize: "0.85rem", color: "var(--text-dim)", textAlign: "center" }}>
                    Waiting for {activeParticipant.name} to complete their turn...
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab === "chat" && <div className="chat-log" role="log" aria-live="polite" aria-atomic="false">
            {eventLogs.map((log) => {
              if (log.type === "system") {
                const p = log.payload as { text: string };
                return (
                  <div key={log.id} className="chat-card chat-card--system" role="note">
                    <span>{p.text}</span>
                    {log.ai_narration && (
                      <div className="chat-card__narration" style={{ fontStyle: "italic", marginTop: "8px", color: "var(--accent-gold)", fontSize: "0.9em", borderTop: "1px solid rgba(184, 134, 11, 0.3)", paddingTop: "8px" }}>
                        ✨ {log.ai_narration}
                      </div>
                    )}
                  </div>
                );
              }
              if (log.type === "chat") {
                const p = log.payload as ChatPayload;
                const isMe = log.actor_name === user?.username;
                return (
                  <div key={log.id} className={`chat-card chat-card--chat${isMe ? " chat-card--me" : ""}`}>
                    <div className="chat-card__header">
                      <span className="chat-card__sender">{log.actor_name ?? p.sender_name}</span>
                      <time className="chat-card__time" dateTime={log.timestamp}>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>
                    <p className="chat-card__text">{p.text}</p>
                    {log.ai_narration && (
                      <div className="chat-card__narration" style={{ fontStyle: "italic", marginTop: "8px", color: "var(--accent-gold)", fontSize: "0.9em", borderTop: "1px solid rgba(184, 134, 11, 0.3)", paddingTop: "8px" }}>
                        ✨ {log.ai_narration}
                      </div>
                    )}
                  </div>
                );
              }
              if (log.type === "exploration") {
                const p = log.payload as ExplorationPayload;
                return (
                  <div key={log.id} className="chat-card chat-card--roll">
                    <div className="chat-card__header">
                      <span className="chat-card__sender">{log.actor_name ?? p.roller_name}</span>
                      <time className="chat-card__time" dateTime={log.timestamp}>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>
                    <div className="roll-result">
                      <div className="roll-result__die" aria-hidden="true">{p.dice_type}</div>
                      <div className="roll-result__breakdown">
                        <span className="roll-result__context">{p.context}</span>
                        <span className="roll-result__formula">
                          {p.raw}{p.modifier !== 0 && <span className="roll-result__mod">{p.modifier >= 0 ? ` +${p.modifier}` : ` ${p.modifier}`}</span>}
                        </span>
                      </div>
                      <div className="roll-result__total" aria-label={`Total: ${p.final}`}>{p.final}</div>
                    </div>
                    {log.ai_narration && (
                      <div className="chat-card__narration" style={{ fontStyle: "italic", marginTop: "8px", color: "var(--accent-gold)", fontSize: "0.9em", borderTop: "1px solid rgba(184, 134, 11, 0.3)", paddingTop: "8px" }}>
                        ✨ {log.ai_narration}
                      </div>
                    )}
                  </div>
                );
              }
              if (log.type === "combat" || log.type === "quest") {
                const p = log.payload as { text?: string };
                // Try to extract some meaningful text, or just show the narration
                
                return (
                  <div key={log.id} className="chat-card chat-card--system" role="note">
                    {p.text && <span>{p.text}</span>}
                    {log.ai_narration && (
                      <div className="chat-card__narration" style={{ fontStyle: "italic", marginTop: p.text ? "8px" : "0", color: "var(--accent-gold)", fontSize: "0.9em", borderTop: p.text ? "1px solid rgba(184, 134, 11, 0.3)" : "none", paddingTop: p.text ? "8px" : "0" }}>
                        ✨ {log.ai_narration}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })}
            <div ref={chatEndRef} />
          </div>}

          {activeTab === "chat" && <form className="chat-input-bar" onSubmit={sendChat} aria-label="Send a message">
            <input type="text" className="input-field chat-input-bar__input"
              placeholder={wsStatus !== "connected" ? "Connecting..." : "Type a message or describe your action..."}
              value={chatMessage} onChange={(e) => setChatMessage(e.target.value)}
              disabled={wsStatus !== "connected"} aria-label="Chat message" id="chat-message-input" />
            <button type="submit" className="btn btn-primary" disabled={wsStatus !== "connected" || !chatMessage.trim()}>
              Send
            </button>
          </form>}
        </main>

        <aside className="sidebar-right" aria-label={activeRole === "dm" ? "DM Panel" : "Character panel"}>
          {activeRole === "dm" ? (
            <div className="right-panel">
              <div className="right-panel__header">
                <h2 className="right-panel__title">DM Panel</h2>
                <span className="right-panel__role-indicator" aria-hidden="true">&#x265B;</span>
              </div>
              <p className="right-panel__dm-desc">You oversee the campaign. Narrate story beats and challenge the party.</p>
              
              <div className="dm-factions-toggle-row" style={{ marginBottom: "16px" }}>
                <button
                  className="btn btn-gold"
                  style={{ width: "100%" }}
                  onClick={() => setShowFactions(true)}
                >
                  🏰 Faction Control Room
                </button>
              </div>
              
              <div className="right-panel__section">
                <div className="sidebar-section-title">Combat Controller</div>
                {activeCombat ? (
                  <div className="dm-combat-status" style={{ padding: "8px", background: "rgba(184,134,11,0.05)", border: "1px solid var(--accent-gold)", borderRadius: "6px" }}>
                    <p className="status-active" style={{ fontSize: "0.85rem", color: "var(--accent-gold)", fontWeight: "bold", margin: "0 0 6px 0" }}>⚔️ Combat is Active (Round {activeCombat.round_number})</p>
                    <div className="turn-indicator" style={{ fontSize: "0.8rem", color: "var(--text-light)" }}>
                      Current Turn: <strong>{activeCombat.turn_order[activeCombat.current_turn_index]?.name}</strong>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (!ws) return;
                    ws.send(JSON.stringify({
                      type: "START_COMBAT",
                      payload: { monsters: [{ id: selectedMonster, count: monsterCount }] }
                    }));
                  }} className="dm-combat-form">
                    <div className="form-group" style={{ marginBottom: "8px" }}>
                      <label htmlFor="monster-select" style={{ fontSize: "0.8rem", color: "var(--text-dim)", display: "block", marginBottom: "4px" }}>Monster Type</label>
                      <select id="monster-select" className="input-field" value={selectedMonster} onChange={e => setSelectedMonster(e.target.value)} style={{ width: "100%", padding: "6px" }}>
                        <option value="goblin">Goblin (CR 1/4)</option>
                        <option value="kobold">Kobold (CR 1/8)</option>
                        <option value="orc">Orc (CR 1/2)</option>
                        <option value="skeleton">Skeleton (CR 1/4)</option>
                        <option value="red_dragon">Red Dragon Wyrmling (CR 4)</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: "12px" }}>
                      <label htmlFor="monster-count" style={{ fontSize: "0.8rem", color: "var(--text-dim)", display: "block", marginBottom: "4px" }}>Count (1-5)</label>
                      <input id="monster-count" type="number" className="input-field" min={1} max={5} value={monsterCount} onChange={e => setMonsterCount(parseInt(e.target.value) || 1)} style={{ width: "100%", padding: "6px" }} />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={wsStatus !== "connected"}>
                      ⚔️ Start Combat
                    </button>
                  </form>
                )}
              </div>

              <div className="right-panel__section">
                <div className="sidebar-section-title">Quick Dice</div>
                <DicePanel onRoll={rollDice} disabled={wsStatus !== "connected"} />
              </div>
            </div>
          ) : myCharacter ? (
            <div className="right-panel animate-fade-in">
              <div className="sheet-header">
                <h2 className="sheet-name">{myCharacter.name}</h2>
                <p className="sheet-meta">Level {myCharacter.level} &middot; {myCharacter.race} {myCharacter.class}</p>
              </div>
              <div className="hp-block">
                <div className="hp-block__label-row">
                  <span>Hit Points</span>
                  <span className="hp-block__values">{myCharacter.hp_current} / {myCharacter.hp_max}</span>
                </div>
                <div className="hp-bar" role="progressbar" aria-valuenow={myCharacter.hp_current} aria-valuemin={0} aria-valuemax={myCharacter.hp_max} aria-label="Hit points">
                  <div className="hp-bar__fill" style={{
                    width: `${Math.max(0, (myCharacter.hp_current / myCharacter.hp_max) * 100)}%`,
                    background: myCharacter.hp_current / myCharacter.hp_max > 0.5 ? "var(--success-green)" : myCharacter.hp_current / myCharacter.hp_max > 0.25 ? "var(--accent-gold)" : "var(--danger-red)",
                  }} />
                </div>
              </div>
              <div className="stat-grid">
                <div className="stat-card"><div className="stat-card__val">{myCharacter.xp}</div><div className="stat-card__lbl">XP</div></div>
                <div className="stat-card"><div className="stat-card__val">{myCharacter.gold}g</div><div className="stat-card__lbl">Gold</div></div>
                <div className="stat-card"><div className="stat-card__val">{derivedAc}</div><div className="stat-card__lbl">AC</div></div>
                <div className="stat-card"><div className="stat-card__val">{equippedItems.length}</div><div className="stat-card__lbl">Equipped</div></div>
                <div className="stat-card"><div className="stat-card__val">{attackBonus >= 0 ? `+${attackBonus}` : attackBonus}</div><div className="stat-card__lbl">Attack</div></div>
                <div className="stat-card"><div className="stat-card__val">{spellcastingAttribute ? spellSaveDc : "-"}</div><div className="stat-card__lbl">Spell DC</div></div>
              </div>

              {/* ASI Point Allocation Alert Banner */}
              {myCharacter && !activeCombat && getAvailableStatPoints(myCharacter) > 0 && (
                <div className="asi-banner" style={{
                  background: "rgba(184, 134, 11, 0.15)",
                  border: "1px solid var(--accent-gold)",
                  borderRadius: "6px",
                  padding: "10px",
                  marginTop: "12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div className="asi-banner__text" style={{ fontSize: "0.85rem", color: "var(--text-light)" }}>
                    ✨ <strong>{getAvailableStatPoints(myCharacter)} Points Available!</strong>
                  </div>
                  <button className="btn btn-gold asi-banner__btn" onClick={() => {
                    setTempAttributes({ ...myCharacter.attributes });
                    setShowAsiModal(true);
                  }} style={{ padding: "4px 8px", fontSize: "0.8rem" }}>
                    Allocate
                  </button>
                </div>
              )}

              <div className="right-panel__section">
                <div className="sidebar-section-title">Faction Reputations</div>
                <div className="faction-reputation-list" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {reputations
                    .filter((r) => r.character_id === myCharacter.id)
                    .map((rep) => {
                      const faction = factions.find((f) => f.id === rep.faction_id);
                      if (!faction) return null;
                      
                      const isFactionHidden = faction.is_hidden;
                      const factionNameDisplay = isFactionHidden ? "??? (Hidden Faction)" : faction.name;

                      let tierColor = "var(--text-muted)";
                      if (rep.tier === "legend") tierColor = "var(--accent-gold)";
                      else if (rep.tier === "champion") tierColor = "#a855f7"; // purple
                      else if (rep.tier === "watched") tierColor = "#f97316"; // orange
                      else if (rep.tier === "wanted") tierColor = "#ef4444"; // red
                      else if (rep.tier === "hunted") tierColor = "#7f1d1d"; // dark red
                      
                      return (
                        <div key={rep.id} className="faction-rep-item" style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "6px 8px",
                          background: "rgba(255, 255, 255, 0.02)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "4px"
                        }}>
                          <span className="faction-rep-name" style={{ fontSize: "0.85rem", fontWeight: "500", color: isFactionHidden ? "var(--text-muted)" : "var(--text-light)" }}>
                            {factionNameDisplay}
                          </span>
                          <span className="faction-rep-badge" style={{
                            fontSize: "0.75rem",
                            fontWeight: "bold",
                            color: tierColor,
                            textTransform: "uppercase",
                            padding: "2px 6px",
                            background: "rgba(0, 0, 0, 0.2)",
                            borderRadius: "3px",
                            border: `1px solid ${tierColor}`
                          }}>
                            {rep.tier} ({rep.score})
                          </span>
                        </div>
                      );
                    })}
                  {reputations.filter((r) => r.character_id === myCharacter.id).length === 0 && (
                    <div className="member-list__empty" style={{ padding: "4px 0" }}>No reputations recorded.</div>
                  )}
                </div>
              </div>

              <div className="right-panel__section">
                <div className="sidebar-section-title">Attributes &mdash; click to roll d20</div>
                <div className="attr-list" role="list">
                  {Object.entries(myCharacter.attributes).map(([attr, score]) => {
                    const n = Number(score);
                    const mod = Math.floor((n - 10) / 2);
                    return (
                      <button key={attr} role="listitem" className="attr-row"
                        onClick={() => rollAttribute(attr, n)} disabled={wsStatus !== "connected"}
                        aria-label={`${attr.toUpperCase()} ${n}, modifier ${mod >= 0 ? "+" : ""}${mod}`}>
                        <span className="attr-row__abbv">{attr.toUpperCase()}</span>
                        <span className="attr-row__score">{n}</span>
                        <span className="attr-row__mod">{mod >= 0 ? `+${mod}` : mod}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Skills</div>
                <div className="skill-list" role="list">
                  {(Object.entries(myCharacter.skills || {}) as Array<[string, number]>).map(([skill, bonus]) => (
                    <button
                      key={skill}
                      role="listitem"
                      className="skill-row"
                      onClick={() => rollSkill(skill, Number(bonus))}
                      disabled={wsStatus !== "connected"}
                      aria-label={`Roll ${skill} with ${Number(bonus) >= 0 ? "+" : ""}${bonus}`}
                    >
                      <span className="skill-row__name">{skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
                      <span className="skill-row__bonus">{Number(bonus) >= 0 ? "+" : ""}{bonus}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Quick Dice</div>
                <DicePanel onRoll={rollDice} disabled={wsStatus !== "connected"} />
              </div>
              <div className="right-panel__section">
                <div className="sidebar-section-title">Inventory</div>
                {inventoryError && <div className="auth-message auth-message--error" role="alert">{inventoryError}</div>}
                {inventory.length === 0 ? (
                  <div className="member-list__empty">No items carried.</div>
                ) : (
                  <div className="inventory-grid">
                    {inventory.map((item) => (
                      <div key={item.id} className={`inventory-item${item.is_equipped ? " inventory-item--equipped" : ""}`}>
                        <div className="inventory-item__top">
                          <div>
                            <div className="inventory-item__name">{item.name}</div>
                            <div className="inventory-item__meta">
                              {item.type}{item.quantity > 1 ? ` x${item.quantity}` : ""}
                            </div>
                          </div>
                          {item.is_equipped && <span className="inventory-item__pill">On</span>}
                        </div>
                        <div className="inventory-item__desc">{item.description}</div>
                        <div className="inventory-item__actions">
                          {!item.is_consumable && (
                            <button className="btn btn-gold inventory-item__action" onClick={() => void toggleInventoryEquip(item)}>
                              {item.is_equipped ? "Unequip" : "Equip"}
                            </button>
                          )}
                          <button className="btn btn-danger inventory-item__action" onClick={() => void dropInventoryItem(item)}>
                            Drop
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="right-panel animate-fade-in">
              <div className="right-panel__header"><h2 className="right-panel__title">Create Character</h2></div>
              <p className="right-panel__dm-desc">You haven't created your adventurer for this campaign yet.</p>
              {charError && <div className="auth-message auth-message--error" role="alert">{charError}</div>}
              <form onSubmit={handleCreateCharacter}>
                <div className="form-group">
                  <label htmlFor="char-name">Name</label>
                  <input id="char-name" type="text" className="input-field" placeholder="e.g. Thorin Ironhammer"
                    value={charName} onChange={(e) => setCharName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="char-race">Race</label>
                  <select id="char-race" className="input-field" value={charRace} onChange={(e) => setCharRace(e.target.value)}>
                    {RACES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="char-class">Class</label>
                  <select id="char-class" className="input-field" value={charClass} onChange={(e) => setCharClass(e.target.value)}>
                    {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "12px" }}>
                  &#x2694; Spawn Character
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
      {/* ASI Allocation Modal */}
      {showAsiModal && myCharacter && (
        <dialog className="modal-dialog" open style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "var(--bg-dark)",
          border: "1px solid var(--border-dark)",
          borderRadius: "12px",
          padding: "24px",
          zIndex: 1000,
          width: "360px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
        }}>
          <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ margin: 0, fontFamily: "var(--font-cinzel)", color: "var(--accent-gold)" }}>ASI Stat Allocator</h3>
            <button type="button" className="btn-close" onClick={() => setShowAsiModal(false)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: "16px" }}>
            Allocate up to {getAvailableStatPoints(myCharacter)} points. Attributes are capped at 20.
          </p>
          
          <div className="asi-list" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {Object.keys(myCharacter.attributes).map((attrKey) => {
              const attr = attrKey as keyof typeof myCharacter.attributes;
              const currentVal = myCharacter.attributes[attr];
              const tempVal = tempAttributes[attr] ?? currentVal;
              
              const spentPoints = Object.entries(tempAttributes).reduce(
                (sum, [k, v]) => sum + (v - myCharacter.attributes[k as keyof typeof myCharacter.attributes]),
                0
              );
              const available = getAvailableStatPoints(myCharacter);
              const canIncrease = tempVal < 20 && spentPoints < available;
              const canDecrease = tempVal > currentVal;

              return (
                <div key={attr} className="asi-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="asi-row__label" style={{ fontWeight: "600", fontSize: "0.9rem", color: "var(--text-light)" }}>{attr.toUpperCase()} ({currentVal})</span>
                  <div className="asi-row__controls" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button 
                      type="button"
                      className="btn btn-ghost asi-btn"
                      onClick={() => setTempAttributes(prev => ({ ...prev, [attr]: Math.max(currentVal, (prev[attr] ?? currentVal) - 1) }))}
                      disabled={!canDecrease}
                      style={{ padding: "2px 8px" }}
                    >
                      -
                    </button>
                    <span className="asi-val" style={{ width: "20px", textAlign: "center", fontWeight: "bold", color: "var(--accent-gold)" }}>{tempVal}</span>
                    <button 
                      type="button"
                      className="btn btn-ghost asi-btn"
                      onClick={() => setTempAttributes(prev => ({ ...prev, [attr]: Math.min(20, (prev[attr] ?? currentVal) + 1) }))}
                      disabled={!canIncrease}
                      style={{ padding: "2px 8px" }}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {(() => {
            const spentPoints = Object.entries(tempAttributes).reduce(
              (sum, [k, v]) => sum + (v - myCharacter.attributes[k as keyof typeof myCharacter.attributes]),
              0
            );
            const available = getAvailableStatPoints(myCharacter);
            const remaining = available - spentPoints;

            return (
              <div className="asi-footer" style={{ marginTop: "20px", paddingTop: "12px", borderTop: "1px solid var(--border-dark)", display: "flex", flexDirection: "column", gap: "12px" }}>
                <span className="asi-remaining" style={{ fontSize: "0.85rem", color: "var(--text-light)" }}>Remaining Points: <strong style={{ color: "var(--accent-gold)" }}>{remaining}</strong></span>
                <div className="asi-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAsiModal(false)}>Cancel</button>
                  <button 
                    type="button"
                    className="btn btn-gold" 
                    onClick={handleAllocateStats}
                    disabled={spentPoints === 0}
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          })()}
        </dialog>
      )}

      {/* Dice Roll Overlay */}
      {activeRoll && (
        <div className="dice-overlay" role="dialog" aria-modal="true" style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.85)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000,
          backdropFilter: "blur(6px)"
        }}>
          <div className="dice-overlay__container" style={{
            background: "rgba(10, 11, 20, 0.95)",
            border: "2px solid var(--accent-gold)",
            borderRadius: "16px",
            padding: "32px",
            textAlign: "center",
            width: "300px",
            boxShadow: "0 15px 35px rgba(0,0,0,0.8)"
          }}>
            <div className="dice-overlay__roller" style={{ fontSize: "1.1rem", fontWeight: "bold", color: "var(--text-light)", marginBottom: "4px" }}>
              {activeRoll.roller_name}
            </div>
            <div className="dice-overlay__context" style={{ fontSize: "0.85rem", color: "var(--accent-gold)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "20px" }}>
              {activeRoll.context || "rolls dice"}
            </div>
            
            <div className="dice-overlay__scene" style={{ height: "120px", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
              <div className={`dice-overlay__die dice-overlay__die--${activeRoll.dice_type}`} style={{
                width: "80px",
                height: "80px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #8b0000, #4a0000)",
                border: "2px solid var(--accent-gold)",
                borderRadius: "50%",
                color: "#fff",
                fontSize: "2rem",
                fontWeight: "bold",
                boxShadow: "0 8px 16px rgba(0,0,0,0.6)",
                textShadow: "0 2px 4px rgba(0,0,0,0.8)"
              }}>
                <span className="dice-overlay__number">
                  {activeRoll.raw}
                </span>
              </div>
            </div>

            <div className="dice-overlay__result">
              <span className="dice-overlay__formula" style={{ fontSize: "0.9rem", color: "var(--text-dim)" }}>
                {activeRoll.raw}
                {activeRoll.modifier !== 0 && (
                  <span className="dice-overlay__mod">
                    {activeRoll.modifier >= 0 ? ` +${activeRoll.modifier}` : ` ${activeRoll.modifier}`}
                  </span>
                )}
              </span>
              <div className="dice-overlay__total" style={{ fontSize: "3rem", fontWeight: "bold", color: "var(--accent-gold)", fontFamily: "var(--font-cinzel)", marginTop: "4px" }}>
                {activeRoll.final}
              </div>
            </div>
          </div>
        </div>
      )}

      {showFactions && <FactionControlRoom onClose={() => setShowFactions(false)} />}
    </div>
  );
}
