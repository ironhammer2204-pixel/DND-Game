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
  title: string;
  tier: NemesisTier;
  personality: NemesisPersonality;
  hp_current: number;
  hp_max: number;
  ac: number;
  attack_bonus: number;
  damage_dice: string;
  damage_modifier: number;
  xp_value: number;
  conditions: string[];
  is_alive: boolean;
  created_at: string;
  updated_at: string;
}

export type NemesisTier = "minion" | "lieutenant" | "boss" | "nemesis" | "legend";
export type NemesisStatus = "active" | "defeated" | "retired";
export type NemesisPersonality = "vengeful" | "calculating" | "sadistic" | "honorable" | "unpredictable";

export interface NemesisHistoryEntry {
  id: string;
  nemesis_id: string;
  event_type: string;
  description: string;
  importance: number;
  created_at: string;
}

// Faction System

export interface Faction {
  id: string;
  campaign_id: string;
  name: string;
  type: FactionType;
  personality: FactionPersonality;
  power: number;
  wealth: number;
  influence: number;
  territory_control: number;
  is_active: boolean;
  created_at: string;
}

export type FactionType = "guild" | "cult" | "kingdom" | "tribe" | "syndicate" | "order";
export type FactionPersonality = "aggressive" | "diplomatic" | "isolationist" | "mercantile" | "expansionist";
export type FactionActionType = "attack" | "defend" | "expand" | "trade" | "sabotage" | "recruit" | "negotiate";
export type TreatyType = "alliance" | "trade" | "non_aggression" | "vassalage";

export interface FactionAction {
  id: string;
  campaign_id: string;
  faction_id: string;
  action_type: FactionActionType;
  target_type?: string;
  target_id?: string;
  pressure_cost: number;
  status: "pending" | "resolved" | "vetoed";
  cooldown_until?: string;
  triggered_by: string;
  created_at: string;
}

export interface FactionRelation {
  id: string;
  faction_a_id: string;
  faction_b_id: string;
  relation_score: number;
  treaty_type?: TreatyType;
  is_at_war: boolean;
  created_at: string;
  updated_at: string;
}

export interface FactionTerritory {
  id: string;
  faction_id: string;
  location_id: string;
  control_level: number;
  contested: boolean;
  created_at: string;
}

export interface PlayerFactionReputation {
  id: string;
  character_id: string;
  faction_id: string;
  reputation_score: number;
  tier: ReputationTier;
  created_at: string;
  updated_at: string;
}

export type ReputationTier = "hated" | "hostile" | "unfriendly" | "neutral" | "friendly" | "honored" | "revered";

// Encyclopedia System

export type EncyclopediaCategory = "npc" | "location" | "faction" | "item" | "event" | "creature" | "era";

export interface EncyclopediaEntry {
  id: string;
  campaign_id: string;
  category: EncyclopediaCategory;
  name: string;
  description: string;
  knowledge_level: KnowledgeLevel;
  importance: number;
  discovered_by: string[];
  related_entry_ids: string[];
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type KnowledgeLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type KnowledgeDiscoverySource = "exploration" | "combat" | "dialogue" | "research" | "rumor" | "dm_grant";

export interface CharacterKnowledge {
  id: string;
  character_id: string;
  entry_id: string;
  knowledge_level: KnowledgeLevel;
  source: KnowledgeDiscoverySource;
  discovered_at: string;
}

export interface EncyclopediaHistoryEvent {
  id: string;
  campaign_id: string;
  entry_id: string;
  event_type: string;
  title: string;
  description: string;
  year: number;
  importance: number;
  involved_entry_ids: string[];
  source_type: string;
  source_id?: string;
  created_at: string;
}

export interface HistoricalEra {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  start_year: number;
  end_year?: number;
  trigger_events: string[];
  created_at: string;
}

export interface Rumor {
  id: string;
  campaign_id: string;
  text: string;
  related_entry_ids: string[];
  is_true: boolean;
  status: "active" | "resolved" | "dismissed";
  created_at: string;
}

export interface CharacterRumor {
  id: string;
  character_id: string;
  rumor_id: string;
  heard_at: string;
  status: "unverified" | "confirmed" | "dismissed";
}

export interface ArtifactProvenance {
  id: string;
  artifact_entry_id: string;
  current_owner_id?: string;
  location_id?: string;
  ownership_history: Array<{ owner_id: string; acquired_at: string }>;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  campaign_id: string;
  session_number: number;
  summary: string;
  key_events: string[];
  created_at: string;
}

// Balancing System

export interface BalanceSnapshot {
  id: string;
  campaign_id: string;
  timestamp: string;
  economy: EconomyMetrics;
  combat: CombatMetrics;
  loot: LootMetrics;
  progression: ProgressionMetrics;
}

export interface EconomyMetrics {
  total_gold_in_circulation: number;
  average_party_gold: number;
  inflation_rate: number;
}

export interface CombatMetrics {
  encounter_count: number;
  player_death_count: number;
  average_encounter_duration_minutes: number;
  difficulty_rating: number;
}

export interface LootMetrics {
  items_distributed: number;
  average_item_value: number;
  rarity_distribution: Record<string, number>;
}

export interface ProgressionMetrics {
  average_party_level: number;
  xp_per_hour: number;
  milestone_completion_rate: number;
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
  category: string;
  adjustment: Record<string, any>;
  reason: string;
  applied_at: string;
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
    action_type: FactionActionType;
    target_type: string;
    target_id: string;
  };
  PAUSE_FACTION_ENGINE: {
    pause: boolean;
  };
  SET_FACTION_RELATION: {
    faction_a_id: string;
    faction_b_id: string;
    relation_score: number;
    treaty_type?: TreatyType;
    is_at_war: boolean;
  };
  TRIGGER_FACTION_EVENT: {
    faction_id: string;
    event_type: string;
    payload: Record<string, any>;
  };
  GRANT_KNOWLEDGE: {
    character_id: string;
    entry_id: string;
    level: KnowledgeLevel;
    source: KnowledgeDiscoverySource;
  };
  RESOLVE_RUMOR: {
    rumor_id: string;
    character_id: string;
    outcome: "confirmed" | "dismissed";
  };
  TRIGGER_SESSION_SUMMARY: Record<string, never>;
  TRIGGER_BALANCE_CYCLE: Record<string, never>;
  UPDATE_CONDITIONS: {
    participant_id: string;
    conditions: string[];
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
  | "KNOWLEDGE_GAINED";

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
    event_type: string;
    description: string;
  };
  FACTION_UPDATE: {
    faction: Faction;
    action?: FactionAction;
    event_type: string;
  };
  ENCYCLOPEDIA_ENTRY_UPDATED: {
    entry: EncyclopediaEntry;
    history_event?: EncyclopediaHistoryEvent;
  };
  RUMOR_HEARD: {
    rumor: Rumor;
    character_id: string;
  };
  RUMOR_RESOLVED: {
    rumor_id: string;
    outcome: "confirmed" | "dismissed";
    truth_revealed?: string;
  };
  SESSION_SUMMARY_READY: {
    session_id: string;
    summary: string;
    key_events: string[];
  };
  FACTION_ACTION_RESOLVED: {
    action: FactionAction;
    result: Record<string, any>;
  };
  FACTION_TREATY_SIGNED: {
    faction_a: Faction;
    faction_b: Faction;
    treaty_type: TreatyType;
  };
  FACTION_WAR_DECLARED: {
    aggressor: Faction;
    defender: Faction;
    casus_belli: string;
  };
  FACTION_COLLAPSED: {
    faction: Faction;
    reason: string;
    successor_faction_id?: string;
  };
  PLAYER_REP_CHANGED: {
    character_id: string;
    faction_id: string;
    old_tier: ReputationTier;
    new_tier: ReputationTier;
    reputation_score: number;
  };
  FACTION_VICTORY: {
    faction: Faction;
    victory_condition: string;
    defeated_factions: string[];
  };
  NEMESIS_AMBUSH: {
    nemesis: Nemesis;
    location_id: string;
    participants: CombatParticipant[];
  };
  ENCYCLOPEDIA_KNOWLEDGE_GRANTED: {
    character_id: string;
    entry: EncyclopediaEntry;
    new_level: KnowledgeLevel;
  };
  ERA_CHANGED: {
    new_era: HistoricalEra;
    previous_era?: HistoricalEra;
    trigger_events: EncyclopediaHistoryEvent[];
  };
  KNOWLEDGE_GAINED: {
    character_id: string;
    entry_id: string;
    category: EncyclopediaCategory;
    knowledge_level: KnowledgeLevel;
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
