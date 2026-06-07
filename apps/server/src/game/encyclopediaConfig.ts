import { EncyclopediaCategory, KnowledgeLevel, KnowledgeDiscoverySource } from "@dnd/shared";

// ============================================================
// IMPORTANCE SCORING FORMULA
// ============================================================

export interface ImportanceFactors {
  deaths_involved?: number;
  factions_involved?: number;
  locations_affected?: number;
  player_characters_involved?: number;
  economic_impact_score?: number;
  dm_importance_override?: number;
}

export function computeImportanceScore(factors: ImportanceFactors): number {
  const {
    deaths_involved = 0,
    factions_involved = 0,
    locations_affected = 0,
    player_characters_involved = 0,
    economic_impact_score = 0,
    dm_importance_override,
  } = factors;

  if (dm_importance_override !== undefined) {
    return dm_importance_override;
  }

  return (
    deaths_involved * 10 +
    factions_involved * 15 +
    locations_affected * 8 +
    player_characters_involved * 20 +
    Math.round(economic_impact_score * 0.1)
  );
}

// Thresholds
export const IMPORTANCE_THRESHOLDS = {
  /** Events below this are NOT recorded in encyclopedia history */
  MINIMUM_RECORD: 15,
  /** Events above this auto-create an encyclopedia history entry */
  AUTO_RECORD: 60,
  /** Events above this trigger era evaluation */
  ERA_TRIGGER: 80,
} as const;

// ============================================================
// KNOWLEDGE LEVEL DEFINITIONS
// ============================================================

export interface KnowledgeLevelDefinition {
  level: KnowledgeLevel;
  name: string;
  triggeredBy: KnowledgeDiscoverySource[];
  description: string;
}

export const KNOWLEDGE_LEVEL_DEFINITIONS: KnowledgeLevelDefinition[] = [
  { level: 0, name: "Unknown",  triggeredBy: [],                                  description: "No knowledge" },
  { level: 1, name: "Rumor",    triggeredBy: ["rumor", "faction_event"],            description: "Heard whispers, unverified" },
  { level: 2, name: "Basic",    triggeredBy: ["exploration", "quest", "npc_dialogue"], description: "General awareness" },
  { level: 3, name: "Detailed", triggeredBy: ["combat", "quest", "npc_dialogue"],  description: "Extended interaction" },
  { level: 4, name: "Expert",   triggeredBy: ["quest", "item"],                    description: "Deep study or interrogation" },
  { level: 5, name: "Complete", triggeredBy: ["dm_grant", "item"],                 description: "Full knowledge" },
];

// ============================================================
// KNOWLEDGE CONTENT TEMPLATES PER CATEGORY
// ============================================================

export type ContentTemplate = Record<KnowledgeLevel, (entry: any) => string>;

export const NPC_CONTENT_TEMPLATE: ContentTemplate = {
  0: () => "???",
  1: (_e) => "A figure whispered about in dark corners. Identity unknown.",
  2: (e) => `${e.title || "A person"} — ${e.subtitle || "role unknown"}. Seen in the region.`,
  3: (e) => `${e.title}: ${e.subtitle || ""}. Affiliated with ${e.full_content?.faction_name || "unknown faction"}. Known for: ${(e.full_content?.known_for || []).slice(0,2).join(", ")}.`,
  4: (e) => `${e.title} (${e.subtitle || ""}): ${e.full_content?.biography_short || e.summary || ""}. Relationships: ${JSON.stringify(e.full_content?.relationships || {})}.`,
  5: (e) => e.custom_lore || e.full_content?.biography_full || e.summary || "Complete record.",
};

export const LOCATION_CONTENT_TEMPLATE: ContentTemplate = {
  0: () => "???",
  1: (_e) => "A place mentioned in passing. Location unclear.",
  2: (e) => `${e.title} — ${e.full_content?.type || "place"} in the region. ${e.summary || ""}`,
  3: (e) => `${e.title}: ${e.summary || ""}. Controlled by: ${e.full_content?.controlling_faction || "unknown"}. Notable features: ${(e.full_content?.features || []).join(", ")}.`,
  4: (e) => `${e.title}: ${e.full_content?.description || e.summary || ""}. History: ${e.full_content?.history_brief || ""}. Known routes: ${(e.full_content?.routes || []).join(", ")}.`,
  5: (e) => e.custom_lore || e.full_content?.full_description || e.summary || "Complete record.",
};

export const FACTION_CONTENT_TEMPLATE: ContentTemplate = {
  0: () => "???",
  1: (_e) => "A secretive organization mentioned in hushed tones.",
  2: (e) => `${e.title} — ${e.full_content?.type || "faction"}. ${e.summary || ""}`,
  3: (e) => `${e.title} (${e.full_content?.type || ""}): ${e.summary || ""}. Leadership: ${e.full_content?.leadership || "unknown"}. Goals: ${(e.full_content?.known_goals || []).join(", ")}.`,
  4: (e) => `${e.title}: Military strength ${e.full_content?.military ?? "?"}/100. Wealth ${e.full_content?.wealth ?? "?"}/100. Influence ${e.full_content?.influence ?? "?"}/100. ${e.full_content?.internal_politics || ""}`,
  5: (e) => e.custom_lore || e.full_content?.full_profile || e.summary || "Complete record.",
};

export const CREATURE_CONTENT_TEMPLATE: ContentTemplate = {
  0: () => "???",
  1: (_e) => "A dangerous creature lurking somewhere in the world.",
  2: (e) => `${e.title} — ${e.full_content?.creature_type || "creature"}. ${e.summary || ""}`,
  3: (e) => `${e.title}: ${e.summary || ""}. Attacks: ${e.full_content?.attacks || "unknown"}. Weaknesses: ${e.full_content?.weaknesses || "unknown"}.`,
  4: (e) => `${e.title}: HP ${e.full_content?.hp || "?"}. AC ${e.full_content?.ac || "?"}. ${e.full_content?.tactics || ""}. Special abilities: ${e.full_content?.special_abilities || "none"}.`,
  5: (e) => e.custom_lore || e.full_content?.full_statblock || e.summary || "Complete record.",
};

export const ITEM_CONTENT_TEMPLATE: ContentTemplate = {
  0: () => "???",
  1: (_e) => "A mysterious artifact spoken of in legend.",
  2: (e) => `${e.title} — ${e.full_content?.item_type || "item"}. ${e.summary || ""}`,
  3: (e) => `${e.title}: ${e.summary || ""}. Properties: ${e.full_content?.properties || "unknown"}. Last known location: ${e.full_content?.last_location || "unknown"}.`,
  4: (e) => `${e.title}: ${e.full_content?.description || e.summary || ""}. Magical properties: ${e.full_content?.magic_properties || "none"}. Crafting: ${e.full_content?.crafting_info || "unknown"}.`,
  5: (e) => e.custom_lore || e.full_content?.full_history || e.summary || "Complete record.",
};

export const CATEGORY_TEMPLATES: Partial<Record<EncyclopediaCategory, ContentTemplate>> = {
  npc: NPC_CONTENT_TEMPLATE,
  location: LOCATION_CONTENT_TEMPLATE,
  faction: FACTION_CONTENT_TEMPLATE,
  creature: CREATURE_CONTENT_TEMPLATE,
  item: ITEM_CONTENT_TEMPLATE,
  artifact: ITEM_CONTENT_TEMPLATE,
};

/** Returns content filtered to the character's knowledge level */
export function getContentAtKnowledgeLevel(
  entry: any,
  level: KnowledgeLevel
): string {
  const template = CATEGORY_TEMPLATES[entry.category as EncyclopediaCategory];
  if (!template) {
    // Fallback for categories without templates
    if (level === 0) return "???";
    if (level <= 2) return entry.summary || "Limited information.";
    return entry.custom_lore || entry.summary || "Information available.";
  }
  return template[level](entry);
}

// ============================================================
// ERA AUTO-TRIGGER CONFIG
// ============================================================

export const ERA_CONFIG: {
  MIN_IMPORTANCE_FOR_ERA_COUNT: number;
  EVENTS_REQUIRED_TO_TRIGGER: number;
  YEAR_WINDOW: number;
  REGIME_CHANGE_EVENT_TYPES: string[];
} = {
  /** Minimum importance for an event to count toward era triggers */
  MIN_IMPORTANCE_FOR_ERA_COUNT: 80,
  /** Number of high-importance events needed within the window */
  EVENTS_REQUIRED_TO_TRIGGER: 3,
  /** Game-year window to check for era-triggering events */
  YEAR_WINDOW: 10,
  /** Event types that count as a "regime change" */
  REGIME_CHANGE_EVENT_TYPES: ["faction_collapse", "assassination", "rebellion_success", "coronation"],
};

// ============================================================
// RUMOR RELIABILITY DECAY CONFIG
// ============================================================

export const RUMOR_CONFIG = {
  /** Reliability lost per 10 game days if unconfirmed */
  DECAY_PER_10_DAYS: 5,
  /** Reliability gained when a related event confirms partial truth */
  PARTIAL_CONFIRM_BONUS: 20,
  /** Reliability that contradicting rumors converge to */
  CONTRADICTION_EQUILIBRIUM: 50,
  /** Reliability spread reduction per "retelling" step */
  SPREAD_REDUCTION: 2,
} as const;

// ============================================================
// KNOWLEDGE LEVEL UPGRADE TRIGGERS
// ============================================================

/** Map of event types to the knowledge level they unlock for related entries */
export const EVENT_KNOWLEDGE_UPGRADES: Record<string, KnowledgeLevel> = {
  "exploration":             2,
  "npc_meet":                2,
  "quest_started":           2,
  "quest_completed":         3,
  "combat":                  3,
  "creature_first_kill":     3,
  "boss_defeated":           4,
  "research_completed":      4,
  "interrogation_completed": 4,
  "dm_grant":                5,
  "tome_found":              5,
  "full_quest_chain":        5,
};
