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

export interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export const SKILL_ABILITY_MAP: Record<string, keyof AbilityScores> = {
  acrobatics: "dexterity",
  animalHandling: "wisdom",
  arcana: "intelligence",
  athletics: "strength",
  deception: "charisma",
  history: "intelligence",
  insight: "wisdom",
  intimidation: "charisma",
  investigation: "intelligence",
  medicine: "wisdom",
  nature: "intelligence",
  perception: "wisdom",
  performance: "charisma",
  persuasion: "charisma",
  religion: "intelligence",
  sleightOfHand: "dexterity",
  stealth: "dexterity",
  survival: "wisdom",
};

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
  ability_scores?: AbilityScores;
  proficiencies?: string[];
  saving_throw_proficiencies?: (keyof AbilityScores)[];
}

export interface ItemCatalog {
  id: string;
  name: string;
  type: string;
  description?: string;
  stats: Record<string, any>;
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
  relationship_map: Record<string, number>;
  known_info: string[];
  memory_log: NPCInteraction[];
  base_stats: Record<string, any>;
  relationship_score?: number;
}

export interface QuestObjective {
  text: string;
  completed: boolean;
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

export interface Location {
  id: string;
  campaign_id: string;
  name: string;
  type: string;
  description?: string;
  state: Record<string, any>;
  connected_locations: string[];
  lore?: string;
}

export interface CombatParticipant {
  id: string;
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
  damage_taken?: number;
  damage_dealt?: number;
  downed_character_ids?: string[];
  nemesis_id?: string;
  nemesis_tier?: NemesisTier;
  personality?: NemesisPersonality;
  grudge_target_id?: string;
  scars?: any[];
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
  actor_id?: string | null;
  payload: Record<string, any>;
  ai_narration?: string | null;
  created_at: string;
}

export interface DiceRoll {
  id: string;
  character_id: string;
  campaign_id: string;
  dice_type: string;
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

// Nemesis System

export interface Nemesis {
  id: string;
  campaign_id: string;
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
  scars: any[];
  appearance: Record<string, any>;
  faction_id?: string | null;
  minion_ids: string[];
  location_id?: string | null;
  target_character_id?: string | null;
  grudge_score: number;
  bounty_on_party: number;
  successor_nemesis_id?: string | null;
  promoted_from_nemesis_id?: string | null;
  source_monster_id?: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at?: string | null;
  faction_name?: string | null;
  location_name?: string | null;
  target_character_name?: string | null;
}

export type NemesisTier = "soldier" | "lieutenant" | "warlord" | "archnemesis";
export type NemesisStatus = "active" | "dead" | "retired" | "missing" | "ambushing";
export type NemesisPersonality = "brutal" | "cowardly" | "cunning" | "honorable" | "vengeful" | "warlord" | "paranoid";

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
}

// Faction System

export interface Faction {
  id: string;
  campaign_id: string;
  name: string;
  disposition: "hostile" | "neutral" | "rival" | "allied";
  power_level: number;
  description?: string | null;
  type: "empire" | "merchant" | "cult" | "rebel" | "criminal" | "secret" | "neutral";
  is_hidden: boolean;
  military: number;
  wealth: number;
  influence: number;
  stability: number;
  pressure: number;
  pressure_cap: number;
  territories: number;
  personality: "expansionist" | "merchant" | "religious" | "revolutionary" | "defensive" | "isolationist";
  objectives: any[];
  victory_condition: Record<string, any>;
  is_victorious: boolean;
  collapsed: boolean;
  created_at: string;
  updated_at: string;
}

export type FactionType = "empire" | "merchant" | "cult" | "rebel" | "criminal" | "secret" | "neutral";
export type FactionPersonality = "expansionist" | "merchant" | "religious" | "revolutionary" | "defensive" | "isolationist";
export type FactionActionType = string;
export type TreatyType = "none" | "truce" | "trade" | "alliance" | "vassalage";

export interface FactionAction {
  id: string;
  campaign_id: string;
  faction_id: string;
  action_type: string;
  target_type: "location" | "npc" | "faction" | "trade_route" | "player";
  target_id: string;
  pressure_cost: number;
  status: "pending" | "resolved" | "vetoed" | "countered";
  result: Record<string, any>;
  cooldown_until?: string | null;
  triggered_by: "engine" | "dm" | "player_action" | "cascade";
  parent_action_id?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

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

export interface PlayerFactionReputation {
  id: string;
  campaign_id: string;
  character_id: string;
  faction_id: string;
  score: number;
  tier: "unknown" | "watched" | "wanted" | "hunted" | "champion" | "legend";
  bounty_amount: number;
  updated_at: string;
}

export type ReputationTier = "unknown" | "watched" | "wanted" | "hunted" | "champion" | "legend";

// Encyclopedia System

export type EncyclopediaCategory =
  | "location"
  | "npc"
  | "faction"
  | "creature"
  | "item"
  | "religion"
  | "language"
  | "technology"
  | "event"
  | "era"
  | "artifact"
  | "player";

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

export type KnowledgeLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type KnowledgeDiscoverySource =
  | "exploration"
  | "combat"
  | "quest"
  | "npc_dialogue"
  | "item"
  | "faction_event"
  | "dm_grant"
  | "rumor";

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

export interface Rumor {
  id: string;
  campaign_id: string;
  entry_id: string;
  content: string;
  reliability: number;
  is_true: boolean | null;
  source_type: "npc" | "faction" | "player" | "dm" | "system";
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

// Balancing System

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
  most_used_build_types: Record<string, any>;
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
  level_distribution: Record<string, any>;
  soft_cap_triggers: Record<string, any>;
  created_at: string;
}

export interface BalanceAlert {
  id: string;
  campaign_id: string;
  category: "economy" | "combat" | "loot" | "progression";
  severity: "warning" | "critical";
  message: string;
  suggested_action?: string;
  created_at: string;
}

export interface BalanceOverride {
  id: string;
  campaign_id: string;
  metric_type: string;
  value: number;
  reason?: string;
  expires_at?: string;
}

export interface CharacterBehaviourLog {
  id: string;
  character_id: string;
  action_type: string;
  context: Record<string, any>;
  timestamp: string;
}

export interface CharacterBehaviourProfile {
  id: string;
  character_id: string;
  playstyle: string;
  risk_tolerance: number;
  social_preference: string;
  combat_role: string;
  updated_at: string;
}

export interface ConsequenceArcLog {
  id: string;
  campaign_id: string;
  arc_name: string;
  trigger_event: string;
  current_status: "active" | "resolved" | "escalated";
  affected_entities: string[];
  created_at: string;
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
  | "VETO_FACTION_ACTION"
  | "FORCE_FACTION_ACTION"
  | "PAUSE_FACTION_ENGINE"
  | "SET_FACTION_RELATION"
  | "TRIGGER_FACTION_EVENT"
  | "GRANT_KNOWLEDGE"
  | "RESOLVE_RUMOR"
  | "TRIGGER_SESSION_SUMMARY"
  | "TRIGGER_BALANCE_CYCLE"
  | "UPDATE_CONDITIONS";

export interface ClientMessageMap {
  ACTION_SUBMIT: {
    type: "exploration" | "skill_check" | "npc_interaction" | "other";
    text: string;
    target_location_id?: string;
  };
  DICE_REQUEST: {
    dice_type: string;
    context: string;
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
  VETO_FACTION_ACTION: {
    action_id: string;
  };
  FORCE_FACTION_ACTION: {
    faction_id: string;
    action_type: string;
    target_type: string;
    target_id: string;
  };
  PAUSE_FACTION_ENGINE: {
    pause: boolean;
  };
  SET_FACTION_RELATION: {
    faction_a_id: string;
    faction_b_id: string;
    score: number;
    treaty_type?: TreatyType;
    expires_in_days?: number;
  };
  TRIGGER_FACTION_EVENT: {
    faction_id: string;
    event_type: string;
    payload?: Record<string, any>;
  };
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
  UPDATE_CONDITIONS: {
    participant_id: string;
    condition: string;
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
  | "ERROR"
  | "NEMESIS_UPDATE"
  | "FACTION_UPDATE"
  | "ENCYCLOPEDIA_ENTRY_UPDATED"
  | "RUMOR_HEARD"
  | "RUMOR_RESOLVED"
  | "SESSION_SUMMARY_READY"
  | "FACTION_ACTION_RESOLVED"
  | "FACTION_TREATY_SIGNED"
  | "FACTION_WAR_DECLARED"
  | "FACTION_COLLAPSED"
  | "PLAYER_REP_CHANGED"
  | "FACTION_VICTORY"
  | "NEMESIS_AMBUSH"
  | "ENCYCLOPEDIA_KNOWLEDGE_GRANTED"
  | "ERA_CHANGED"
  | "KNOWLEDGE_GAINED"
  | "WORLD_EXPANDED"
  | "CAMPAIGN_LAUNCHED"
  | "WORLD_STATE_UPDATE"
  | "WORLD_EVENT";

export interface ServerMessageMap {
  GAME_EVENT: {
    id: string;
    type: "combat" | "quest" | "chat" | "exploration" | "system";
    actor_name?: string;
    payload: Record<string, any>;
    timestamp: string;
    ai_narration?: string;
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
    roll_breakdown?: {
      raw_rolls?: number[];
      ability_modifier?: number;
      proficiency_bonus?: number;
      dc?: number;
      success?: boolean;
      is_crit?: boolean;
      is_fumble?: boolean;
    };
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
  ERROR: {
    code: string;
    message: string;
  };
  NEMESIS_UPDATE: {
    nemesis: Nemesis;
    history_entry?: NemesisHistoryEntry;
    reason: string;
  };
  FACTION_UPDATE: {
    faction: Faction;
    action?: FactionAction;
    event_type?: string;
  };
  ENCYCLOPEDIA_ENTRY_UPDATED: {
    entry: EncyclopediaEntry;
    reason: string;
  };
  RUMOR_HEARD: {
    rumor: Rumor;
    character_id: string;
  };
  RUMOR_RESOLVED: {
    rumor_id: string;
    is_true: boolean;
    narrative: string;
  };
  SESSION_SUMMARY_READY: {
    session: SessionRecord;
    approved: boolean;
  };
  FACTION_ACTION_RESOLVED: {
    action: FactionAction;
    narrative: string;
  };
  FACTION_TREATY_SIGNED: {
    faction_a_id: string;
    faction_b_id: string;
    treaty_type: "none" | "truce" | "trade" | "alliance" | "vassalage";
    narrative: string;
  };
  FACTION_WAR_DECLARED: {
    faction_a_id: string;
    faction_b_id: string;
    narrative: string;
  };
  FACTION_COLLAPSED: {
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
  FACTION_VICTORY: {
    faction_id: string;
    narrative: string;
  };
  NEMESIS_AMBUSH: {
    nemesis: Nemesis;
    location_id?: string | null;
    message: string;
  };
  ENCYCLOPEDIA_KNOWLEDGE_GRANTED: {
    character_id: string;
    entry_id: string;
    knowledge_level: KnowledgeLevel;
    discovery_source: KnowledgeDiscoverySource;
  };
  ERA_CHANGED: {
    era: HistoricalEra;
    trigger_event_id?: string | null;
    narrative: string;
  };
  KNOWLEDGE_GAINED: {
    character_id: string;
    entry_id: string;
    knowledge_level: KnowledgeLevel;
    discovery_source: KnowledgeDiscoverySource;
    entry_title: string;
  };
  WORLD_EXPANDED: {
    campaign_id: string;
    locations: number;
    npcs: number;
    factions: number;
    quests: number;
    world_summary: string;
  };
  CAMPAIGN_LAUNCHED: {
    campaign_id: string;
    opening_narration: string;
    starting_location: Location | null;
    active_quests: Quest[];
    party: Character[];
  };
  WORLD_STATE_UPDATE: {
    weather: string;
    time_of_day: string;
    campaign_day: number;
    weather_effects?: Record<string, unknown>;
    time_effects?: Record<string, unknown>;
  };
  WORLD_EVENT: {
    event_id: string;
    text: string;
    timestamp: string;
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
