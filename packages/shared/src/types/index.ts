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
  party_perception?: string;
  relationship_score?: number;
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

export type FactionType = "empire" | "merchant" | "cult" | "rebel" | "criminal" | "secret" | "neutral";
export type FactionPersonality = "expansionist" | "merchant" | "religious" | "revolutionary" | "defensive" | "isolationist";

export interface Faction {
  id: string;
  campaign_id: string;
  name: string;
  disposition: "hostile" | "neutral" | "rival" | "allied";
  power_level: number;
  description?: string | null;
  created_at: string;
  type: FactionType;
  is_hidden: boolean;
  military: number;
  wealth: number;
  influence: number;
  stability: number;
  pressure: number;
  pressure_cap: number;
  territories: number;
  personality: FactionPersonality;
  objectives: string[];
  victory_condition: Record<string, any>;
  is_victorious: boolean;
  collapsed: boolean;
  updated_at: string;
  nemeses?: any[];
}

export type TreatyType = "none" | "truce" | "trade" | "alliance" | "vassalage";

export interface FactionRelation {
  id: string;
  campaign_id: string;
  faction_a_id: string;
  faction_b_id: string;
  score: number;
  treaty_type: TreatyType;
  treaty_expires_at?: string | null;
  updated_at: string;
}

export interface FactionTerritory {
  id: string;
  campaign_id: string;
  location_id: string;
  faction_id: string;
  pressure_value: number;
  control_percent: number;
  is_claimed: boolean;
  updated_at: string;
}

export type FactionActionType =
  | "patrol"
  | "raid"
  | "siege"
  | "invade"
  | "fortify"
  | "recruit"
  | "bribe_official"
  | "fund_trade_route"
  | "create_shortage"
  | "price_manipulation"
  | "corrupt_governor"
  | "replace_mayor"
  | "pass_law"
  | "assassination"
  | "blackmail"
  | "spy_network"
  | "sabotage"
  | "convert_citizens"
  | "build_temple"
  | "declare_holy_war";

export type FactionActionStatus = "pending" | "resolved" | "vetoed" | "countered";

export interface FactionAction {
  id: string;
  campaign_id: string;
  faction_id: string;
  action_type: string;
  target_type: "location" | "npc" | "faction" | "trade_route" | "player";
  target_id: string;
  pressure_cost: number;
  status: FactionActionStatus;
  result: Record<string, any>;
  cooldown_until?: string | null;
  triggered_by: "engine" | "dm" | "player_action" | "cascade";
  parent_action_id?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface FactionPressureLog {
  id: string;
  campaign_id: string;
  faction_id: string;
  cycle_number: number;
  pressure_generated: number;
  pressure_spent: number;
  pressure_decayed: number;
  actions_taken: any[];
  logged_at: string;
}

export type ReputationTier = "unknown" | "watched" | "wanted" | "hunted" | "champion" | "legend";

export interface PlayerFactionReputation {
  id: string;
  campaign_id: string;
  character_id: string;
  faction_id: string;
  score: number;
  tier: ReputationTier;
  bounty_amount: number;
  updated_at: string;
}

export interface NpcFactionAlignment {
  id: string;
  npc_id: string;
  faction_id: string;
  alignment_score: number;
  is_agent: boolean;
  updated_at: string;
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
  | "UPDATE_CONDITIONS"
  | "VETO_FACTION_ACTION"
  | "FORCE_FACTION_ACTION"
  | "PAUSE_FACTION_ENGINE"
  | "SET_FACTION_RELATION"
  | "TRIGGER_FACTION_EVENT"
  // Encyclopedia / Balance messages
  | "GRANT_KNOWLEDGE"
  | "RESOLVE_RUMOR"
  | "TRIGGER_SESSION_SUMMARY"
  | "TRIGGER_BALANCE_CYCLE";

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
  VETO_FACTION_ACTION: {
    action_id: string;
  };
  FORCE_FACTION_ACTION: {
    faction_id: string;
    action_type: string;
    target_type: "location" | "npc" | "faction" | "trade_route" | "player";
    target_id: string;
  };
  PAUSE_FACTION_ENGINE: {
    pause: boolean;
  };
  SET_FACTION_RELATION: {
    faction_a_id: string;
    faction_b_id: string;
    score: number;
    treaty_type: string;
    expires_in_days?: number;
  };
  TRIGGER_FACTION_EVENT: {
    faction_id: string;
    event_type: string;
  };
  // Encyclopedia / Balance client messages
  GRANT_KNOWLEDGE: {
    character_id: string;
    entry_id: string;
    knowledge_level?: KnowledgeLevel;
    discovery_source?: KnowledgeDiscoverySource;
  };
  RESOLVE_RUMOR: {
    rumor_id: string;
    is_true: boolean;
  };
  TRIGGER_SESSION_SUMMARY: {
    session_id: string;
  };
  TRIGGER_BALANCE_CYCLE: Record<string, never>;
}

// ============================================================
// ENCYCLOPEDIA SYSTEM TYPES
// ============================================================

export type EncyclopediaCategory =
  | "location" | "npc" | "faction" | "creature" | "item"
  | "religion" | "language" | "technology" | "event" | "era"
  | "artifact" | "player";

/** 0=unknown,1=rumor,2=basic,3=detailed,4=expert,5=complete */
export type KnowledgeLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type KnowledgeDiscoverySource =
  | "exploration" | "combat" | "quest" | "npc_dialogue" | "item"
  | "faction_event" | "dm_grant" | "rumor";

export interface EncyclopediaEntry {
  id: string;
  campaign_id: string;
  category: EncyclopediaCategory;
  source_id?: string | null;
  source_type?: string | null;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  full_content: Record<string, any>;
  importance: number;
  tags: string[];
  is_secret: boolean;
  dm_notes?: string | null;
  custom_lore?: string | null;
  pinned: boolean;
  era_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterKnowledge {
  id: string;
  campaign_id: string;
  character_id: string;
  entry_id: string;
  knowledge_level: KnowledgeLevel;
  discovered_at: string;
  discovery_source: KnowledgeDiscoverySource;
  updated_at: string;
}

export interface EncyclopediaHistoryEvent {
  id: string;
  campaign_id: string;
  entry_id: string;
  event_type: string;
  title: string;
  description?: string | null;
  year?: number | null;
  importance: number;
  involved_entry_ids: string[];
  source_type: "combat" | "faction" | "quest" | "dm" | "system";
  source_id?: string | null;
  created_at: string;
}

export interface HistoricalEra {
  id: string;
  campaign_id: string;
  name: string;
  start_year?: number | null;
  end_year?: number | null;
  description?: string | null;
  trigger_event_id?: string | null;
  created_at: string;
}

export type RumorSource = "npc" | "faction" | "player" | "dm" | "system";

export interface Rumor {
  id: string;
  campaign_id: string;
  entry_id: string;
  content: string;
  reliability: number;
  is_true?: boolean | null;
  source_type: RumorSource;
  source_id?: string | null;
  spread_count: number;
  contradicts_rumor_id?: string | null;
  resolved_at?: string | null;
  created_at: string;
}

export interface CharacterRumor {
  id: string;
  character_id: string;
  rumor_id: string;
  heard_at: string;
  believed: boolean;
}

export interface ArtifactProvenance {
  id: string;
  campaign_id: string;
  item_entry_id: string;
  owner_type: "character" | "npc" | "faction" | "location" | "unknown";
  owner_id?: string | null;
  acquired_via: "found" | "purchased" | "stolen" | "gifted" | "crafted" | "quest" | "looted";
  year?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  campaign_id: string;
  session_number: number;
  started_at?: string | null;
  ended_at?: string | null;
  player_character_ids: string[];
  event_ids: string[];
  ai_summary?: string | null;
  dm_notes?: string | null;
  summary_approved: boolean;
  importance: number;
  created_at: string;
}

// ============================================================
// BALANCING ENGINE TYPES
// ============================================================

export interface BalanceSnapshot {
  id: string;
  campaign_id: string;
  snapshot_type: "economy" | "combat" | "faction" | "loot" | "progression";
  data: Record<string, any>;
  flags: Record<string, any>;
  recommendations: Record<string, any>;
  applied: boolean;
  created_at: string;
}

export interface EconomyMetrics {
  id: string;
  campaign_id: string;
  cycle_number: number;
  total_gold_in_circulation: number;
  gold_generated_this_cycle: number;
  gold_sunk_this_cycle: number;
  inflation_index: number;
  avg_player_wealth: number;
  wealth_gini: number;
  created_at: string;
}

export interface CombatMetrics {
  id: string;
  campaign_id: string;
  cycle_number: number;
  avg_combat_duration_rounds: number;
  avg_player_damage_per_round: number;
  avg_enemy_damage_per_round: number;
  win_rate: number;
  death_rate: number;
  most_used_build_types: Record<string, number>;
  dominant_build_percent: number;
  sessions_sampled: number;
  created_at: string;
}

export interface LootMetrics {
  id: string;
  campaign_id: string;
  cycle_number: number;
  item_id: string;
  drop_count: number;
  usage_count: number;
  sell_count: number;
  current_drop_rate: number;
  recommended_drop_rate: number;
  created_at: string;
}

export interface ProgressionMetrics {
  id: string;
  campaign_id: string;
  cycle_number: number;
  avg_character_level: number;
  xp_per_session_avg: number;
  level_distribution: Record<string, number>;
  soft_cap_triggers: Record<string, any>;
  created_at: string;
}

// ============================================================
// EXTENDED WEBSOCKET MESSAGE TYPES
// ============================================================

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
  | "FACTION_ACTION_RESOLVED"
  | "FACTION_WAR_DECLARED"
  | "FACTION_TREATY_SIGNED"
  | "FACTION_COLLAPSED"
  | "FACTION_VICTORY"
  | "PLAYER_REP_CHANGED"
  // Encyclopedia events
  | "ENCYCLOPEDIA_ENTRY_UPDATED"
  | "ENCYCLOPEDIA_KNOWLEDGE_GRANTED"
  | "KNOWLEDGE_GAINED"
  | "RUMOR_HEARD"
  | "RUMOR_RESOLVED"
  | "ERA_CHANGED"
  | "SESSION_SUMMARY_READY"
  // Balance events
  | "BALANCE_CYCLE_COMPLETE"
  | "BALANCE_ALERT"
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
  FACTION_ACTION_RESOLVED: {
    action: FactionAction;
    narrative: string;
  };
  FACTION_WAR_DECLARED: {
    faction_a_id: string;
    faction_b_id: string;
    narrative: string;
  };
  FACTION_TREATY_SIGNED: {
    faction_a_id: string;
    faction_b_id: string;
    treaty_type: string;
    narrative: string;
  };
  FACTION_COLLAPSED: {
    faction_id: string;
    narrative: string;
  };
  FACTION_VICTORY: {
    faction_id: string;
    narrative: string;
  };
  PLAYER_REP_CHANGED: {
    character_id: string;
    faction_id: string;
    score: number;
    tier: string;
    narrative: string;
  };
  // Encyclopedia events
  ENCYCLOPEDIA_ENTRY_UPDATED: {
    entry: EncyclopediaEntry;
    reason?: string;
  };
  ENCYCLOPEDIA_KNOWLEDGE_GRANTED: {
    character_id: string;
    entry_id: string;
    knowledge_level: KnowledgeLevel;
    discovery_source: KnowledgeDiscoverySource;
  };
  KNOWLEDGE_GAINED: {
    character_id: string;
    entry_id: string;
    knowledge_level: KnowledgeLevel;
    discovery_source: KnowledgeDiscoverySource;
    entry_title: string;
  };
  RUMOR_HEARD: {
    character_id: string;
    rumor: Rumor;
  };
  RUMOR_RESOLVED: {
    rumor_id: string;
    is_true: boolean;
    narrative: string;
  };
  ERA_CHANGED: {
    era: HistoricalEra;
    trigger_event_id?: string;
    narrative: string;
  };
  SESSION_SUMMARY_READY: {
    session: SessionRecord;
    approved: boolean;
  };
  BALANCE_CYCLE_COMPLETE: {
    campaign_id: string;
    cycle_number: number;
    adjustments: Record<string, unknown>[];
  };
  BALANCE_ALERT: {
    alert_id: string;
    metric_type: string;
    severity: "info" | "warning" | "critical";
    message: string;
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
