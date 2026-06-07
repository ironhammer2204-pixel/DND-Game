/**
 * contextBuilder.ts
 *
 * Assembles read-only context snapshots from the DB for AI DM prompts.
 * These functions NEVER write. They return plain objects — never raw DB rows.
 * The AI sees only what is in the returned snapshot. Nothing else.
 *
 * Uses the shared `pg` pool (same one used by game engines) so all reads
 * happen inside the same transaction context when needed.
 */

import { Pool, PoolClient } from "pg";
import type {
  PartyContext,
  LocationContext,
  NpcContext,
  QuestContext,
  EventHistoryEntry,
  NemesisContext,
} from "./promptTemplates";

// ---------------------------------------------------------------------------
// Party
// ---------------------------------------------------------------------------

/**
 * Returns the current state of every active player-character in a campaign.
 * Only includes characters that are campaign_members with status = 'active'.
 */
export async function getPartyContext(
  client: Pool | PoolClient,
  campaignId: string
): Promise<PartyContext[]> {
  const { rows } = await client.query<{
    name: string;
    race: string;
    class_name: string;
    hp_current: number;
    hp_max: number;
  }>(
    `SELECT c.name, c.race, c.class_name, c.hp_current, c.hp_max
     FROM characters c
     JOIN campaign_members cm ON cm.character_id = c.id
     WHERE cm.campaign_id = $1 AND cm.status = 'active'
     ORDER BY c.name`,
    [campaignId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/**
 * Returns the display-safe fields for a location.
 */
export async function getLocationContext(
  client: Pool | PoolClient,
  locationId: string
): Promise<LocationContext | null> {
  const { rows } = await client.query<{
    name: string;
    description: string;
    lore: string | null;
  }>(
    `SELECT name, description, lore
     FROM locations
     WHERE id = $1`,
    [locationId]
  );
  if (!rows.length) return null;
  return {
    name: rows[0].name,
    description: rows[0].description,
    lore: rows[0].lore ?? undefined,
  };
}

/**
 * Returns the location_id for a campaign's current location.
 * Characters in the campaign share a single campaign-level location.
 */
export async function getCampaignLocationId(
  client: Pool | PoolClient,
  campaignId: string
): Promise<string | null> {
  const { rows } = await client.query<{ current_location_id: string | null }>(
    `SELECT current_location_id FROM campaigns WHERE id = $1`,
    [campaignId]
  );
  return rows[0]?.current_location_id ?? null;
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

/**
 * Returns NPCs present in the given location, with their relationship value
 * toward the party (averaged across all party members, or 0 if none stored).
 */
export async function getNpcsAtLocation(
  client: Pool | PoolClient,
  locationId: string,
  campaignId: string
): Promise<NpcContext[]> {
  const { rows } = await client.query<{
    name: string;
    archetype: string;
    relationship_value: number | null;
  }>(
    `SELECT n.name, n.archetype, n.relationship_value
     FROM npcs n
     WHERE n.location_id = $1
       AND n.campaign_id = $2
       AND n.is_alive = true
     ORDER BY n.name`,
    [locationId, campaignId]
  );
  return rows.map(r => ({
    name: r.name,
    archetype: r.archetype,
    relationship_value: r.relationship_value ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

/**
 * Returns active quests for a campaign. Only exposes title + current objective —
 * never internal IDs, reward amounts, or hidden flags.
 */
export async function getActiveQuestContext(
  client: Pool | PoolClient,
  campaignId: string
): Promise<QuestContext[]> {
  const { rows } = await client.query<{
    title: string;
    status: string;
    current_objective: string;
  }>(
    `SELECT title, status, current_objective
     FROM quests
     WHERE campaign_id = $1
       AND status = 'active'
     ORDER BY created_at ASC`,
    [campaignId]
  );
  return rows.map(r => ({
    title: r.title,
    status: r.status as QuestContext["status"],
    current_objective: r.current_objective,
  }));
}

// ---------------------------------------------------------------------------
// Event history
// ---------------------------------------------------------------------------

/**
 * Returns the last N event_log entries for a campaign, summarised.
 * AI narration text itself is excluded to avoid circular self-reinforcement.
 */
export async function getRecentEvents(
  client: Pool | PoolClient,
  campaignId: string,
  limit = 10
): Promise<EventHistoryEntry[]> {
  const { rows } = await client.query<{ summary: string }>(
    `SELECT COALESCE(summary, event_type) AS summary
     FROM event_log
     WHERE campaign_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [campaignId, limit]
  );
  // Return in chronological order (oldest first) for narrative coherence
  return rows.reverse().map(r => ({ summary: r.summary }));
}

// ---------------------------------------------------------------------------
// Nemesis
// ---------------------------------------------------------------------------

/**
 * Returns the active nemesis for a campaign, if any.
 * Only returns nemeses with status = 'active' and tier not 'defeated'.
 */
export async function getActiveNemesisContext(
  client: Pool | PoolClient,
  campaignId: string
): Promise<NemesisContext | null> {
  const { rows } = await client.query<{
    name: string;
    tier: string;
    personality_preset: string;
    epithets: string[] | null;
  }>(
    `SELECT name, tier, personality_preset, epithets
     FROM nemeses
     WHERE campaign_id = $1
       AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1`,
    [campaignId]
  );
  if (!rows.length) return null;
  return {
    name: rows[0].name,
    tier: rows[0].tier,
    personality_preset: rows[0].personality_preset,
    epithets: rows[0].epithets ?? [],
  };
}

// ---------------------------------------------------------------------------
// Convenience: full campaign snapshot
// ---------------------------------------------------------------------------

export interface CampaignSnapshot {
  campaignId: string;
  party: PartyContext[];
  location: LocationContext | null;
  npcs: NpcContext[];
  quests: QuestContext[];
  recentEvents: EventHistoryEntry[];
  nemesis: NemesisContext | null;
}

/**
 * One-shot helper that fetches everything the AI DM needs in parallel.
 * Use this when building context for action / movement narration.
 */
export async function buildCampaignSnapshot(
  client: Pool | PoolClient,
  campaignId: string
): Promise<CampaignSnapshot> {
  const locationId = await getCampaignLocationId(client, campaignId);

  const [party, location, npcs, quests, recentEvents, nemesis] =
    await Promise.all([
      getPartyContext(client, campaignId),
      locationId ? getLocationContext(client, locationId) : Promise.resolve(null),
      locationId
        ? getNpcsAtLocation(client, locationId, campaignId)
        : Promise.resolve([]),
      getActiveQuestContext(client, campaignId),
      getRecentEvents(client, campaignId),
      getActiveNemesisContext(client, campaignId),
    ]);

  return {
    campaignId,
    party,
    location,
    npcs,
    quests,
    recentEvents,
    nemesis,
  };
}
