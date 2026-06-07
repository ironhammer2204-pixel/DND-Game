// Database Entity Interfaces

export interface User {
  id: string;
  email: string;
  username: string;
  avatar_url?: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  world_state: Record<string, any>;
  session_count: number;
  created_at: string;
}

export interface Attributes {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface Skills {
  acrobatics: number;
  animalHandling: number;
  arcana: number;
  athletics: number;
  deception: number;
  history: number;
  insight: number;
  intimidation: number;
  investigation: number;
  medicine: number;
  nature: number;
  perception: number;
  performance: number;
  persuasion: number;
  religion: number;
  sleightOfHand: number;
  stealth: number;
  survival: number;
}

export interface Character {
  id: string;
  user_id: string;
  campaign_id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  xp: number;
  hp_current: number;
  hp_max: number;
  attributes: Attributes;
  skills: Skills;
  gold: number;
  reputation: Record<string, number>;
  is_alive: boolean;
  updated_at: string;
}

export interface ItemCatalog {
  id: string;
  name: string;
  type: string; // 'weapon' | 'armor' | 'consumable' | 'misc'
  description?: string;
  stats: Record<string, any>; // { damage?: string, ac_bonus?: number, etc. }
  value_gp: number;
  is_consumable: boolean;
}

export interface InventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  quantity: number;
  is_equipped: boolean;
  acquired_at: string;
  // Join helper field
  item?: ItemCatalog;
}

export interface NPCInteraction {
  timestamp: string;
  event_id?: string;
  summary: string;
}

export interface NPC {
  id: string;
  campaign_id: string;
  name: string;
  role?: string | null;
  location_id: string;
  is_alive: boolean;
  relationship_map: Record<string, number>; // character_id -> score
  known_info: string[];
  memory_log: NPCInteraction[];
  base_stats: Record<string, any>;
}

export interface QuestObjective {
  text: string;
  completed: boolean;
  nemesis_id?: string;
}

export interface Quest {
  id: string;
  campaign_id: string;
  type: "main" | "side" | "random";
  title: string;
  description?: string | null;
  status: "active" | "complete" | "failed";
  objectives: QuestObjective[];
  rewards: Record<string, any>;
  giver_npc_id?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export type NemesisTier = "soldier" | "lieutenant" | "warlord" | "archnemesis";
export type NemesisStatus = "active" | "dead" | "retired" | "missing" | "ambushing";
export type NemesisPersonality =
  | "brutal"
  | "cowardly"
  | "cunning"
  | "honorable"
  | "vengeful"
  | "warlord"
  | "paranoid";

export interface NemesisScar {
  type: string;
  label: string;
  effect: string;
  applied_at: string;
}

export interface Faction {
  id: string;
  campaign_id: string;
  name: string;
  disposition: "hostile" | "neutral" | "rival" | "allied";
  power_level: number;
  description?: string | null;
  created_at: string;
  nemeses?: any[];
}

export interface Nemesis {
  id: string;
  campaign_id: string;
  source_monster_id?: string | null;
  name: string;
  epithet?: string | null;
  tier: NemesisTier;
  status: NemesisStatus;
  level: number;
  xp: number;
  personality: NemesisPersonality;
  traits: Record<string, any>;
  tactics: Record<string, any>;
  stats: Record<string, any>;
  scars: NemesisScar[];
  appearance: Record<string, any>;
  faction_id?: string | null;
  minion_ids: string[];
  location_id?: string | null;
  target_character_id?: string | null;
  grudge_score: number;
  bounty_on_party: number;
  successor_nemesis_id?: string | null;
  promoted_from_nemesis_id?: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at?: string | null;
  faction_name?: string | null;
  location_name?: string | null;
  target_character_name?: string | null;
}

export interface NemesisHistoryEntry {
  id: string;
  nemesis_id: string;
  campaign_id: string;
  encounter_id?: string | null;
  event_type: string;
  actor_character_id?: string | null;
  summary: string;
  mechanical_data: Record<string, any>;
  occurred_at: string;
  actor_character_name?: string | null;
}

export interface Location {
  id: string;
  campaign_id: string;
  name: string;
  type: string; // 'city' | 'village' | 'dungeon' | 'wilderness'
  description?: string;
  state: Record<string, any>; // { destroyed?: boolean, discovered?: boolean, etc. }
  connected_locations: string[]; // array of location UUIDs
  lore?: string;
}

export interface CombatParticipant {
  id: string; // character_id or enemy instance id
  name: string;
  type: "player" | "enemy";
  hp_current: number;
  hp_max: number;
  initiative: number;
  conditions: string[];
  death_save_successes?: number;
  death_save_failures?: number;
  ac: number;
  attack_bonus: number;
  damage_dice: string;
  damage_modifier: number;
  xp_value?: number;
  source_monster_id?: string;
  nemesis_id?: string;
  nemesis_tier?: NemesisTier;
  personality?: NemesisPersonality;
  grudge_target_id?: string;
  damage_dealt?: number;
  damage_taken?: number;
  downed_character_ids?: string[];
  scars?: NemesisScar[];
  minion_ids?: string[];
}


export interface CombatEncounter {
  id: string;
  campaign_id: string;
  status: "active" | "resolved";
  turn_order: CombatParticipant[];
  current_turn_index: number;
  participants: CombatParticipant[];
  round_number: number;
  started_at: string;
}

export interface EventLog {
  id: string;
  campaign_id: string;
  type: "combat" | "quest" | "chat" | "exploration" | "system";
  actor_id?: string | null; // character_id or npc_id
  payload: Record<string, any>;
  ai_narration?: string | null;
  created_at: string;
}

export interface DiceRoll {
  id: string;
  character_id: string;
  campaign_id: string;
  dice_type: string; // 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100'
  raw_value: number;
  modifier: number;
  final_value: number;
  context?: string;
  rolled_at: string;
}

export interface CampaignMember {
  campaign_id: string;
  user_id: string;
  character_id?: string | null;
  role: "player" | "dm";
  joined_at: string;
  last_seen_at: string;
}

// WebSocket Event Types and Payload Definitions

export type ClientMessageType =
  | "ACTION_SUBMIT"
  | "DICE_REQUEST"
  | "CHAT_MESSAGE"
  | "JOIN_CAMPAIGN"
  | "RECONNECT"
  | "COMBAT_ACTION"
  | "START_COMBAT"
  | "DEATH_SAVE_ROLL"
  | "UPDATE_CONDITIONS";

export interface ClientMessageMap {
  ACTION_SUBMIT: {
    type: "exploration" | "skill_check" | "npc_interaction" | "other";
    text: string;
    target_location_id?: string;
  };
  DICE_REQUEST: {
    dice_type: string; // e.g., 'd20'
    context: string;   // e.g., 'skill:perception'
    modifier: number;
  };
  CHAT_MESSAGE: {
    text: string;
  };
  JOIN_CAMPAIGN: {
    invite_code: string;
  };
  RECONNECT: {
    campaign_id: string;
    character_id?: string;
  };
  COMBAT_ACTION: {
    action_type: "attack" | "dodge" | "use_item" | "end_turn";
    target_id?: string;
  };
  START_COMBAT: {
    monsters: { id: string; count: number }[];
  };
  DEATH_SAVE_ROLL: Record<string, never>;
  UPDATE_CONDITIONS: {
    participant_id: string;
    condition: "poisoned" | "stunned" | "paralysed" | "dodging";
    action: "add" | "remove";
  };
}

export type ServerMessageType =
  | "GAME_EVENT"
  | "AI_NARRATION"
  | "COMBAT_UPDATE"
  | "DICE_RESULT"
  | "PLAYER_JOINED"
  | "PLAYER_LEFT"
  | "QUEST_UPDATE"
  | "WORLD_UPDATE"
  | "NEMESIS_UPDATE"
  | "NEMESIS_AMBUSH"
  | "FACTION_UPDATE"
  | "ERROR";

export interface ServerMessageMap {
  GAME_EVENT: {
    id: string;
    type: "combat" | "quest" | "chat" | "exploration" | "system";
    actor_name?: string;
    payload: Record<string, any>;
    timestamp: string;
  };
  AI_NARRATION: {
    event_id: string;
    text: string;
    is_complete: boolean;
  };
  COMBAT_UPDATE: {
    encounter: CombatEncounter;
  };
  DICE_RESULT: {
    roller_id: string;
    roller_name: string;
    dice_type: string;
    raw: number;
    modifier: number;
    final: number;
    context: string;
  };
  PLAYER_JOINED: {
    user_id: string;
    username: string;
    character?: Character | null;
  };
  PLAYER_LEFT: {
    user_id: string;
    username: string;
  };
  QUEST_UPDATE: {
    quest: Quest;
  };
  WORLD_UPDATE: {
    location_id: string;
    actor_id?: string;
    actor_name?: string;
    from_location?: string;
    to_location?: string;
    changes: Record<string, any>;
  };
  NEMESIS_UPDATE: {
    nemesis: Nemesis;
    history_entry?: NemesisHistoryEntry;
    reason?: string;
  };
  NEMESIS_AMBUSH: {
    nemesis: Nemesis;
    location_id?: string | null;
    message: string;
  };
  FACTION_UPDATE: {
    faction: Faction;
  };
  ERROR: {
    code: string;
    message: string;
  };
}

export interface ClientWSMessage<T extends ClientMessageType> {
  type: T;
  payload: ClientMessageMap[T];
}

export interface ServerWSMessage<T extends ServerMessageType> {
  type: T;
  payload: ServerMessageMap[T];
}
