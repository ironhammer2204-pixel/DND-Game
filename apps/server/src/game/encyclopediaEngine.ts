import { Pool, PoolClient } from "pg";
import {
  EncyclopediaEntry,
  EncyclopediaCategory,
  CharacterKnowledge,
  KnowledgeLevel,
  KnowledgeDiscoverySource,
  EncyclopediaHistoryEvent,
  HistoricalEra,
  Rumor,
  CharacterRumor,
  ArtifactProvenance,
  SessionRecord,
} from "@dnd/shared";
import { RoomManager } from "../websocket/roomManager";
import { dmService } from "../ai/dmService";
import {
  computeImportanceScore,
  ImportanceFactors,
  IMPORTANCE_THRESHOLDS,
  ERA_CONFIG,
  RUMOR_CONFIG,
  getContentAtKnowledgeLevel,
  EVENT_KNOWLEDGE_UPGRADES,
} from "./encyclopediaConfig";

type Client = Pool | PoolClient;

// ============================================================
// INTERNAL HELPERS
// ============================================================

function asJson<T>(value: T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function rowToEntry(row: Record<string, unknown>): EncyclopediaEntry {
  return {
    ...row,
    full_content: asJson(row.full_content ?? {}),
    tags: (row.tags as string[]) ?? [],
  } as EncyclopediaEntry;
}

function rowToHistory(row: Record<string, unknown>): EncyclopediaHistoryEvent {
  return {
    ...row,
    involved_entry_ids: (row.involved_entry_ids as string[]) ?? [],
  } as EncyclopediaHistoryEvent;
}

// ============================================================
// ENTRY MANAGEMENT
// ============================================================

/**
 * Auto-creates an encyclopedia entry when a world object (NPC/location/faction/item) is spawned.
 * Uses UPSERT on source_type + source_id to avoid duplicates.
 */
export async function createEntryFromSource(
  client: Client,
  sourceType: EncyclopediaCategory,
  sourceId: string,
  campaignId: string
): Promise<EncyclopediaEntry | null> {
  try {
    // Check if entry already exists for this source
    const existing = await client.query(
      "SELECT * FROM public.encyclopedia_entries WHERE campaign_id = $1 AND source_type = $2 AND source_id = $3",
      [campaignId, sourceType, sourceId]
    );
    if (existing.rows.length > 0) return rowToEntry(existing.rows[0]);

    // Fetch source entity data to populate entry
    let title = "Unknown";
    let subtitle: string | null = null;
    let summary: string | null = null;
    const fullContent: Record<string, unknown> = {};

    if (sourceType === "npc") {
      const res = await client.query("SELECT name, role, location_id FROM public.npcs WHERE id = $1", [sourceId]);
      if (res.rows.length > 0) {
        title = res.rows[0].name;
        subtitle = res.rows[0].role || null;
        fullContent.location_id = res.rows[0].location_id;
      }
    } else if (sourceType === "location") {
      const res = await client.query("SELECT name, type, description FROM public.locations WHERE id = $1", [sourceId]);
      if (res.rows.length > 0) {
        title = res.rows[0].name;
        subtitle = res.rows[0].type || null;
        summary = res.rows[0].description || null;
        fullContent.type = res.rows[0].type;
      }
    } else if (sourceType === "faction") {
      const res = await client.query(
        "SELECT name, type, description, military, wealth, influence FROM public.factions WHERE id = $1",
        [sourceId]
      );
      if (res.rows.length > 0) {
        title = res.rows[0].name;
        subtitle = res.rows[0].type || null;
        summary = res.rows[0].description || null;
        fullContent.type = res.rows[0].type;
        fullContent.military = res.rows[0].military;
        fullContent.wealth = res.rows[0].wealth;
        fullContent.influence = res.rows[0].influence;
      }
    } else if (sourceType === "player") {
      const res = await client.query(
        "SELECT name, race, class, level FROM public.characters WHERE id = $1",
        [sourceId]
      );
      if (res.rows.length > 0) {
        title = res.rows[0].name;
        subtitle = `${res.rows[0].race} ${res.rows[0].class}`;
        fullContent.race = res.rows[0].race;
        fullContent.class = res.rows[0].class;
        fullContent.level = res.rows[0].level;
      }
    }

    const res = await client.query(
      `INSERT INTO public.encyclopedia_entries
       (campaign_id, category, source_id, source_type, title, subtitle, summary, full_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [campaignId, sourceType, sourceId, sourceType, title, subtitle, summary, JSON.stringify(fullContent)]
    );

    const entry = rowToEntry(res.rows[0]);
    RoomManager.broadcastToRoom(campaignId, "ENCYCLOPEDIA_ENTRY_UPDATED", { entry, reason: "created" });
    return entry;
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] createEntryFromSource error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Enriches an existing entry when a world event fires (combat, faction action, quest).
 */
export async function updateEntryFromEvent(
  client: Client,
  entryId: string,
  campaignId: string,
  eventData: Record<string, unknown>,
  importanceGain = 0
): Promise<EncyclopediaEntry | null> {
  try {
    const res = await client.query(
      `UPDATE public.encyclopedia_entries
       SET full_content = full_content || $1::jsonb,
           importance = importance + $2,
           updated_at = now()
       WHERE id = $3 AND campaign_id = $4
       RETURNING *`,
      [JSON.stringify(eventData), importanceGain, entryId, campaignId]
    );
    if (res.rows.length === 0) return null;
    const entry = rowToEntry(res.rows[0]);
    RoomManager.broadcastToRoom(campaignId, "ENCYCLOPEDIA_ENTRY_UPDATED", { entry, reason: "updated" });
    return entry;
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] updateEntryFromEvent error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Computes importance score from event factors.
 */
export function computeImportance(factors: ImportanceFactors): number {
  return computeImportanceScore(factors);
}

// ============================================================
// HISTORY EVENTS
// ============================================================

/**
 * Records an encyclopedia history event if importance exceeds threshold.
 * Returns the new history event or null if below threshold.
 */
export async function recordHistoryEvent(
  client: Client,
  campaignId: string,
  entryId: string,
  eventType: string,
  title: string,
  description: string,
  importance: number,
  options: {
    year?: number;
    involvedEntryIds?: string[];
    sourceType?: EncyclopediaHistoryEvent["source_type"];
    sourceId?: string;
  } = {}
): Promise<EncyclopediaHistoryEvent | null> {
  if (importance < IMPORTANCE_THRESHOLDS.MINIMUM_RECORD) return null;

  try {
    const res = await client.query(
      `INSERT INTO public.encyclopedia_history
       (campaign_id, entry_id, event_type, title, description, year, importance, involved_entry_ids, source_type, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        campaignId,
        entryId,
        eventType,
        title,
        description,
        options.year ?? null,
        importance,
        options.involvedEntryIds ?? [],
        options.sourceType ?? "system",
        options.sourceId ?? null,
      ]
    );

    const event = rowToHistory(res.rows[0]);

    // Update entry importance
    await client.query(
      "UPDATE public.encyclopedia_entries SET importance = importance + $1 WHERE id = $2",
      [Math.floor(importance * 0.1), entryId]
    );

    // Check era trigger
    if (importance >= IMPORTANCE_THRESHOLDS.ERA_TRIGGER) {
      await evaluateEraChange(client, campaignId, event.id);
    }

    return event;
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] recordHistoryEvent error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ============================================================
// ERA MANAGEMENT
// ============================================================

/**
 * Checks if recent high-importance events plus a regime change should trigger a new era.
 */
export async function evaluateEraChange(
  client: Client,
  campaignId: string,
  triggerEventId?: string
): Promise<HistoricalEra | null> {
  try {
    // Get current game year from campaign world_state
    const campaignRes = await client.query(
      "SELECT world_state FROM public.campaigns WHERE id = $1",
      [campaignId]
    );
    const worldState = campaignRes.rows[0]?.world_state ?? {};
    const currentYear: number = worldState.current_year ?? 1;
    const minYear = currentYear - ERA_CONFIG.YEAR_WINDOW;

    // Count high-importance events in the year window
    const countRes = await client.query(
      `SELECT count(*)::int AS cnt, 
              array_agg(event_type) AS types
       FROM public.encyclopedia_history
       WHERE campaign_id = $1
         AND importance >= $2
         AND (year IS NULL OR year >= $3)`,
      [campaignId, ERA_CONFIG.MIN_IMPORTANCE_FOR_ERA_COUNT, minYear]
    );

    const count: number = countRes.rows[0]?.cnt ?? 0;
    const eventTypes: string[] = countRes.rows[0]?.types ?? [];

    if (count < ERA_CONFIG.EVENTS_REQUIRED_TO_TRIGGER) return null;

    // Check for regime change event type
    const hasRegimeChange = eventTypes.some((t) =>
      ERA_CONFIG.REGIME_CHANGE_EVENT_TYPES.includes(t)
    );
    if (!hasRegimeChange) return null;

    // Close current era
    await client.query(
      "UPDATE public.historical_eras SET end_year = $1 WHERE campaign_id = $2 AND end_year IS NULL",
      [currentYear - 1, campaignId]
    );

    // Determine era name from dominant event theme
    const eraName = deriveEraName(eventTypes, currentYear);

    // Create new era
    const res = await client.query(
      `INSERT INTO public.historical_eras
       (campaign_id, name, start_year, trigger_event_id, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        campaignId,
        eraName,
        currentYear,
        triggerEventId ?? null,
        `A new era began in year ${currentYear}, shaped by ${eventTypes.slice(0, 3).join(", ")}.`,
      ]
    );

    const era: HistoricalEra = res.rows[0];
    RoomManager.broadcastToRoom(campaignId, "ERA_CHANGED", {
      era,
      trigger_event_id: triggerEventId,
      narrative: `A new era has begun: ${eraName}`,
    });
    return era;
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] evaluateEraChange error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function deriveEraName(eventTypes: string[], year: number): string {
  const themes: Record<string, string> = {
    assassination: "Age of Blood",
    faction_collapse: "Age of Fracture",
    rebellion_success: "Age of Liberation",
    battle: "Age of War",
    coronation: "Age of Crowns",
    founding: "Age of Foundation",
    discovery: "Age of Discovery",
  };
  for (const [key, name] of Object.entries(themes)) {
    if (eventTypes.includes(key)) {
      return `${name} (Year ${year})`;
    }
  }
  return `The New Age (Year ${year})`;
}

// ============================================================
// KNOWLEDGE MANAGEMENT
// ============================================================

/**
 * Writes or upgrades character_knowledge. Never downgrades.
 */
export async function grantKnowledge(
  client: Client,
  characterId: string,
  entryId: string,
  campaignId: string,
  level: KnowledgeLevel,
  source: KnowledgeDiscoverySource
): Promise<CharacterKnowledge | null> {
  try {
    // Get entry for broadcast data
    const entryRes = await client.query(
      "SELECT title FROM public.encyclopedia_entries WHERE id = $1",
      [entryId]
    );
    const entryTitle: string = entryRes.rows[0]?.title ?? "Unknown";

    const res = await client.query(
      `INSERT INTO public.character_knowledge
         (campaign_id, character_id, entry_id, knowledge_level, discovery_source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (character_id, entry_id)
       DO UPDATE SET
         knowledge_level = GREATEST(character_knowledge.knowledge_level, EXCLUDED.knowledge_level),
         discovery_source = CASE
           WHEN EXCLUDED.knowledge_level > character_knowledge.knowledge_level
           THEN EXCLUDED.discovery_source
           ELSE character_knowledge.discovery_source
         END,
         updated_at = now()
       RETURNING *`,
      [campaignId, characterId, entryId, level, source]
    );

    const knowledge: CharacterKnowledge = res.rows[0];

    // Broadcast to all clients — the frontend filters by character ownership
    RoomManager.broadcastToRoom(campaignId, "KNOWLEDGE_GAINED", {
      character_id: characterId,
      entry_id: entryId,
      knowledge_level: knowledge.knowledge_level as KnowledgeLevel,
      discovery_source: knowledge.discovery_source as KnowledgeDiscoverySource,
      entry_title: entryTitle,
    });

    return knowledge;
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] grantKnowledge error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Returns an encyclopedia entry with content filtered to the character's knowledge level.
 */
export async function getFilteredEntry(
  client: Client,
  characterId: string,
  entryId: string,
  campaignId: string,
  isDm = false
): Promise<(EncyclopediaEntry & { filtered_content: string; knowledge_level: KnowledgeLevel }) | null> {
  try {
    const entryRes = await client.query(
      "SELECT * FROM public.encyclopedia_entries WHERE id = $1 AND campaign_id = $2",
      [entryId, campaignId]
    );
    if (entryRes.rows.length === 0) return null;
    const entry = rowToEntry(entryRes.rows[0]);

    // DMs see everything
    if (isDm) {
      return { ...entry, filtered_content: entry.custom_lore || entry.summary || "", knowledge_level: 5 };
    }

    const knowledgeRes = await client.query(
      "SELECT knowledge_level FROM public.character_knowledge WHERE character_id = $1 AND entry_id = $2",
      [characterId, entryId]
    );
    const level: KnowledgeLevel = (knowledgeRes.rows[0]?.knowledge_level ?? 0) as KnowledgeLevel;

    if (level === 0) return null; // Unknown entries are invisible to players

    const filteredContent = getContentAtKnowledgeLevel(entry, level);
    return { ...entry, filtered_content: filteredContent, knowledge_level: level };
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] getFilteredEntry error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ============================================================
// RUMOR SYSTEM
// ============================================================

/**
 * Spreads a rumor to a list of characters with the telephone reliability decay effect.
 */
export async function spreadRumor(
  client: Client,
  rumor: Rumor,
  characterIds: string[]
): Promise<void> {
  try {
    for (let i = 0; i < characterIds.length; i++) {
      const charId = characterIds[i];

      // Insert into character_rumors (ignore conflict if already heard)
      await client.query(
        `INSERT INTO public.character_rumors (character_id, rumor_id)
         VALUES ($1, $2)
         ON CONFLICT (character_id, rumor_id) DO NOTHING`,
        [charId, rumor.id]
      );

      // Broadcast
      const adjustedRumor: Rumor = {
        ...rumor,
        reliability: Math.max(0, rumor.reliability - i * RUMOR_CONFIG.SPREAD_REDUCTION),
      };
      RoomManager.broadcastToRoom(rumor.campaign_id, "RUMOR_HEARD", {
        character_id: charId,
        rumor: adjustedRumor,
      });
    }

    // Update spread_count
    await client.query(
      "UPDATE public.rumors SET spread_count = spread_count + $1 WHERE id = $2",
      [characterIds.length, rumor.id]
    );
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] spreadRumor error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Resolves a rumor as true or false. Upgrades or discredits linked character knowledge.
 */
export async function resolveRumor(
  client: Client,
  rumorId: string,
  campaignId: string,
  isTrue: boolean
): Promise<void> {
  try {
    const rumorRes = await client.query(
      "SELECT * FROM public.rumors WHERE id = $1 AND campaign_id = $2",
      [rumorId, campaignId]
    );
    if (rumorRes.rows.length === 0) return;
    const rumor: Rumor = rumorRes.rows[0];

    // Mark rumor resolved
    await client.query(
      "UPDATE public.rumors SET is_true = $1, resolved_at = now() WHERE id = $2",
      [isTrue, rumorId]
    );

    // Get characters who heard this rumor
    const charRumorRes = await client.query(
      "SELECT character_id FROM public.character_rumors WHERE rumor_id = $1",
      [rumorId]
    );
    const characterIds: string[] = charRumorRes.rows.map((r: { character_id: string }) => r.character_id);

    const narrative = isTrue
      ? `The rumor about "${rumor.content.slice(0, 60)}..." proved to be TRUE.`
      : `The rumor about "${rumor.content.slice(0, 60)}..." was FALSE.`;

    if (isTrue) {
      // Upgrade knowledge for characters who believed it
      const believedRes = await client.query(
        "SELECT character_id FROM public.character_rumors WHERE rumor_id = $1 AND believed = true",
        [rumorId]
      );
      for (const row of believedRes.rows) {
        await grantKnowledge(client, row.character_id, rumor.entry_id, campaignId, 2, "rumor");
      }
    }

    // Resolve contradicting rumor
    if (rumor.contradicts_rumor_id) {
      await client.query(
        "UPDATE public.rumors SET is_true = $1, resolved_at = now() WHERE id = $2",
        [!isTrue, rumor.contradicts_rumor_id]
      );
    }

    RoomManager.broadcastToRoom(campaignId, "RUMOR_RESOLVED", {
      rumor_id: rumorId,
      is_true: isTrue,
      narrative,
    });
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] resolveRumor error:", err instanceof Error ? err.message : String(err));
  }
}

// ============================================================
// BIOGRAPHY & NARRATIVE GENERATORS
// ============================================================

/**
 * Assembles a narrative biography for an NPC from structured data + history events.
 */
export function generateBiography(
  entry: EncyclopediaEntry,
  historyEvents: EncyclopediaHistoryEvent[]
): string {
  const content = entry.full_content as Record<string, unknown>;
  const events = [...historyEvents].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

  const lines: string[] = [];

  if (entry.title) {
    lines.push(`**${entry.title}** ${entry.subtitle ? `(${entry.subtitle})` : ""}`);
  }

  if (content.biography_short || entry.summary) {
    lines.push((content.biography_short as string) || entry.summary || "");
  }

  if (events.length > 0) {
    lines.push("\n**Key Events:**");
    for (const event of events.slice(0, 8)) {
      const yearStr = event.year != null ? `Year ${event.year}: ` : "";
      lines.push(`- ${yearStr}${event.description || event.title}`);
    }
  }

  if (content.known_for && (content.known_for as string[]).length > 0) {
    lines.push(`\n**Known for:** ${(content.known_for as string[]).join(", ")}`);
  }

  if (entry.custom_lore) {
    lines.push(`\n${entry.custom_lore}`);
  }

  return lines.join("\n") || "No biography available.";
}

/**
 * Assembles faction history narrative from structured data + history events.
 */
export function generateFactionHistory(
  entry: EncyclopediaEntry,
  historyEvents: EncyclopediaHistoryEvent[]
): string {
  const content = entry.full_content as Record<string, unknown>;
  const events = [...historyEvents].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

  const lines: string[] = [];
  lines.push(`**${entry.title}** — ${content.type || "Organization"}`);

  if (entry.summary) lines.push(entry.summary);

  if (content.leadership) lines.push(`**Current Leadership:** ${content.leadership}`);

  if ((content.known_goals as string[])?.length > 0) {
    lines.push(`**Known Goals:** ${(content.known_goals as string[]).join(", ")}`);
  }

  if (events.length > 0) {
    lines.push("\n**Historical Record:**");
    for (const event of events.slice(0, 10)) {
      const yearStr = event.year != null ? `Year ${event.year}: ` : "";
      lines.push(`- ${yearStr}${event.description || event.title}`);
    }
  }

  if (entry.custom_lore) lines.push(`\n${entry.custom_lore}`);

  return lines.join("\n") || "No faction history available.";
}

// ============================================================
// ARTIFACT PROVENANCE
// ============================================================

/**
 * Records an ownership transfer in artifact_provenance.
 */
export async function recordArtifactProvenance(
  client: Client,
  itemEntryId: string,
  campaignId: string,
  ownerType: ArtifactProvenance["owner_type"],
  ownerId: string | null,
  via: ArtifactProvenance["acquired_via"],
  year?: number,
  notes?: string
): Promise<ArtifactProvenance | null> {
  try {
    const res = await client.query(
      `INSERT INTO public.artifact_provenance
       (campaign_id, item_entry_id, owner_type, owner_id, acquired_via, year, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [campaignId, itemEntryId, ownerType, ownerId, via, year ?? null, notes ?? null]
    );
    return res.rows[0] as ArtifactProvenance;
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] recordArtifactProvenance error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ============================================================
// SESSION SUMMARIZER (GROQ via OpenAI-compatible API)
// ============================================================

/**
 * Generates an AI session summary via Groq, stores it, and broadcasts to DM.
 */
export async function generateSessionSummary(
  client: Client,
  sessionId: string,
  campaignId: string
): Promise<SessionRecord | null> {
  try {
    const sessionRes = await client.query(
      "SELECT * FROM public.session_records WHERE id = $1 AND campaign_id = $2",
      [sessionId, campaignId]
    );
    if (sessionRes.rows.length === 0) return null;
    const session: SessionRecord = sessionRes.rows[0];

    // Fetch campaign name
    const campaignRes = await client.query("SELECT name, session_count FROM public.campaigns WHERE id = $1", [campaignId]);
    const campaignName: string = campaignRes.rows[0]?.name ?? "Unknown Campaign";

    // Fetch characters
    const charIds: string[] = session.player_character_ids;
    const charRes = await client.query(
      "SELECT name, race, class FROM public.characters WHERE id = ANY($1::uuid[])",
      [charIds]
    );
    const characters = charRes.rows.map((c: { name: string; race: string; class: string }) => `${c.name} (${c.race} ${c.class})`);

    // Fetch top 10 events by importance
    const eventIds: string[] = session.event_ids;
    let topEvents: Record<string, unknown>[] = [];
    if (eventIds.length > 0) {
      const eventRes = await client.query(
        `SELECT payload, type FROM public.event_log
         WHERE id = ANY($1::uuid[])
         ORDER BY created_at ASC
         LIMIT 10`,
        [eventIds]
      );
      topEvents = eventRes.rows;
    }

    // Fetch nemeses and factions active
    const nemesisRes = await client.query(
      "SELECT name, epithet, tier FROM public.nemeses WHERE campaign_id = $1 AND status = 'active' LIMIT 5",
      [campaignId]
    );
    const factionRes = await client.query(
      "SELECT name FROM public.factions WHERE campaign_id = $1 AND collapsed = false LIMIT 5",
      [campaignId]
    );

    const eventSummaries = topEvents
      .map((e) => {
        const payload = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
        return payload.text || payload.action_type || e.type;
      })
      .filter(Boolean);

    const prompt = `You are a historian summarizing a D&D session. Write in past tense, third person. 3–5 paragraphs. Focus on player actions, key decisions, and world consequences. Do not list stats or numbers.

Campaign: ${campaignName}
Session: #${session.session_number}
Characters: ${characters.join(", ") || "Unknown"}
Key events: ${eventSummaries.slice(0, 10).join("; ") || "No major events"}
Nemeses encountered: ${nemesisRes.rows.map((n: { name: string; epithet: string | null; tier: string }) => `${n.name} ${n.epithet || ""} (${n.tier})`).join(", ") || "None"}
Factions active: ${factionRes.rows.map((f: { name: string }) => f.name).join(", ") || "None"}

Generate a narrative summary of this session.`;

    let summary = "";
    try {
      summary = await dmService.generateSessionSummary(prompt);
    } catch (aiErr: unknown) {
      console.error("[encyclopediaEngine] AI summary generation failed:", aiErr instanceof Error ? aiErr.message : String(aiErr));
      summary = `Session ${session.session_number} summary could not be generated automatically. Key events: ${eventSummaries.slice(0, 5).join("; ")}.`;
    }

    // Store summary
    const updatedRes = await client.query(
      `UPDATE public.session_records
       SET ai_summary = $1, summary_approved = false
       WHERE id = $2
       RETURNING *`,
      [summary, sessionId]
    );
    const updated: SessionRecord = updatedRes.rows[0];

    // Broadcast to DM only (frontend filters by role)
    RoomManager.broadcastToRoom(campaignId, "SESSION_SUMMARY_READY", {
      session: updated,
      approved: false,
    });

    return updated;
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] generateSessionSummary error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ============================================================
// FULL-TEXT SEARCH
// ============================================================

/**
 * Searches encyclopedia entries with knowledge-level filtering.
 * Only returns entries the character has at least level-1 knowledge of.
 */
export async function searchEncyclopedia(
  client: Client,
  campaignId: string,
  characterId: string | null,
  query: string,
  isDm = false,
  limit = 20
): Promise<Array<EncyclopediaEntry & { knowledge_level: KnowledgeLevel; filtered_content: string }>> {
  try {
    const sanitized = query.replace(/[%_]/g, "\$&");
    const pattern = `%${sanitized}%`;

    if (isDm) {
      // DM sees all non-secret entries matching query
      const res = await client.query(
        `SELECT * FROM public.encyclopedia_entries
         WHERE campaign_id = $1
           AND (title ILIKE $2 OR summary ILIKE $2 OR subtitle ILIKE $2)
         ORDER BY pinned DESC, importance DESC
         LIMIT $3`,
        [campaignId, pattern, limit]
      );
      return res.rows.map((row: Record<string, unknown>) => {
        const entry = rowToEntry(row);
        return { ...entry, knowledge_level: 5 as KnowledgeLevel, filtered_content: entry.summary || "" };
      });
    }

    if (!characterId) return [];

    // Player: only entries with knowledge_level >= 1
    const res = await client.query(
      `SELECT e.*, ck.knowledge_level
       FROM public.encyclopedia_entries e
       JOIN public.character_knowledge ck ON ck.entry_id = e.id AND ck.character_id = $3
       WHERE e.campaign_id = $1
         AND e.is_secret = false
         AND ck.knowledge_level >= 1
         AND (e.title ILIKE $2 OR e.summary ILIKE $2 OR e.subtitle ILIKE $2)
       ORDER BY e.pinned DESC, e.importance DESC
       LIMIT $4`,
      [campaignId, pattern, characterId, limit]
    );

    return res.rows.map((row: Record<string, unknown>) => {
      const entry = rowToEntry(row);
      const level = (row.knowledge_level ?? 1) as KnowledgeLevel;
      const filteredContent = getContentAtKnowledgeLevel(entry, level);
      return { ...entry, knowledge_level: level, filtered_content: filteredContent };
    });
  } catch (err: unknown) {
    console.error("[encyclopediaEngine] searchEncyclopedia error:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ============================================================
// BULK QUERY HELPERS (used by API routes)
// ============================================================

export async function getEncyclopediaForCharacter(
  client: Client,
  campaignId: string,
  characterId: string,
  category?: EncyclopediaCategory
): Promise<Array<EncyclopediaEntry & { knowledge_level: KnowledgeLevel }>> {
  const categoryFilter = category ? "AND e.category = $4" : "";
  const params: (string | number)[] = [campaignId, characterId, 1];
  if (category) params.push(category);

  const res = await client.query(
    `SELECT e.*, ck.knowledge_level
     FROM public.encyclopedia_entries e
     JOIN public.character_knowledge ck ON ck.entry_id = e.id AND ck.character_id = $2
     WHERE e.campaign_id = $1
       AND e.is_secret = false
       AND ck.knowledge_level >= $3
       ${categoryFilter}
     ORDER BY e.pinned DESC, e.importance DESC`,
    params
  );

  return res.rows.map((row: Record<string, unknown>) => ({
    ...rowToEntry(row),
    knowledge_level: row.knowledge_level as KnowledgeLevel,
  }));
}

export async function getEncyclopediaTimeline(
  client: Client,
  campaignId: string,
  characterId: string | null,
  isDm = false
): Promise<EncyclopediaHistoryEvent[]> {
  if (isDm) {
    const res = await client.query(
      "SELECT * FROM public.encyclopedia_history WHERE campaign_id = $1 ORDER BY year ASC, created_at ASC",
      [campaignId]
    );
    return res.rows.map(rowToHistory);
  }

  if (!characterId) return [];

  // Players: events for entries they know about
  const res = await client.query(
    `SELECT eh.*
     FROM public.encyclopedia_history eh
     JOIN public.character_knowledge ck ON ck.entry_id = eh.entry_id AND ck.character_id = $2
     WHERE eh.campaign_id = $1 AND ck.knowledge_level >= 2
     ORDER BY eh.year ASC, eh.created_at ASC`,
    [campaignId, characterId]
  );
  return res.rows.map(rowToHistory);
}

export async function getCharacterRumors(
  client: Client,
  campaignId: string,
  characterId: string
): Promise<Rumor[]> {
  const res = await client.query(
    `SELECT r.*
     FROM public.rumors r
     JOIN public.character_rumors cr ON cr.rumor_id = r.id
     WHERE r.campaign_id = $1 AND cr.character_id = $2
     ORDER BY r.created_at DESC`,
    [campaignId, characterId]
  );
  return res.rows as Rumor[];
}
