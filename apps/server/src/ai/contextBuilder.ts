/**
 * contextBuilder.ts
 *
 * Assembles read-only context snapshots from the DB for AI DM prompts.
 * These functions NEVER write. They return plain objects — never raw DB rows.
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

export interface CampaignMeta {
  name: string;
  tone: string;
  world_summary: string;
  opening_narration: string;
  random_event_seeds: string[];
}

// ---------------------------------------------------------------------------
// Campaign Meta
// ---------------------------------------------------------------------------

export async function buildCampaignMeta(
  client: Pool | PoolClient,
  campaignId: string
): Promise<CampaignMeta | null> {
  try {
    const res = await client.query(
      "SELECT name, settings, world_state FROM public.campaigns WHERE id = $1",
      [campaignId]
    );
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const settings = row.settings || {};
    const worldState = row.world_state || {};

    return {
      name: row.name,
      tone: settings.tone || "dark",
      world_summary: worldState.world_summary || "A dark fantasy world where empires crumble and ancient powers stir beneath the earth.",
      opening_narration: worldState.opening_narration || "",
      random_event_seeds: worldState.random_event_seeds || [],
    };
  } catch (err: unknown) {
    console.error("[contextBuilder] buildCampaignMeta error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Party
// ---------------------------------------------------------------------------

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
    `SELECT c.name, c.race, c.class AS class_name, c.hp_current, c.hp_max
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

interface AgendaState {
  blocked_reason?: string;
  ticks_at_current_step?: number;
  last_action?: string;
}

export async function getNpcsAtLocation(
  client: Pool | PoolClient,
  locationId: string,
  campaignId: string
): Promise<NpcContext[]> {
  const { rows } = await client.query<{
    name: string;
    archetype: string;
    relationship_map: Record<string, number>;
    agenda_state: AgendaState | null;
  }>(
    `SELECT n.name, n.archetype, n.relationship_map, n.agenda_state
     FROM npcs n
     WHERE n.location_id = $1
       AND n.campaign_id = $2
       AND n.is_alive = true
     ORDER BY n.name`,
    [locationId, campaignId]
  );
  return rows.map((r) => {
    const map = r.relationship_map || {};
    const values = Object.values(map);
    const avgTrust =
      values.length > 0
        ? values.reduce((sum, val) => sum + val, 0) / values.length
        : 0;

    let hint = "neutral";
    const state = r.agenda_state || {};
    if (state.blocked_reason) {
      hint = "evasive, changes subject when pressed";
    } else if (state.ticks_at_current_step && state.ticks_at_current_step > 3) {
      hint = "appears frustrated, distracted";
    } else if (state.last_action === "seek_ally") {
      hint = "seems to be looking for someone";
    } else if (state.last_action === "spread_rumour") {
      hint = "unusually talkative, asking odd questions";
    }

    return {
      name: r.name,
      archetype: r.archetype,
      relationship_value: avgTrust,
      disposition_hint: hint,
    };
  });
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

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
  return rows.map((r) => ({
    title: r.title,
    status: r.status as QuestContext["status"],
    current_objective: r.current_objective,
  }));
}

// ---------------------------------------------------------------------------
// Event history
// ---------------------------------------------------------------------------

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
  return rows.reverse().map((r) => ({ summary: r.summary }));
}

// ---------------------------------------------------------------------------
// Nemesis
// ---------------------------------------------------------------------------

export async function getActiveNemesisContext(
  client: Pool | PoolClient,
  campaignId: string
): Promise<NemesisContext | null> {
  const { rows } = await client.query<{
    name: string;
    tier: string;
    personality_preset: string;
    epithet: string | null;
  }>(
    `SELECT name, tier, personality_preset, epithet
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
    epithet: rows[0].epithet ?? undefined,
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
  meta: CampaignMeta | null;
}

export async function buildCampaignSnapshot(
  client: Pool | PoolClient,
  campaignId: string
): Promise<CampaignSnapshot> {
  const locationId = await getCampaignLocationId(client, campaignId);
  const [meta, party, location, npcs, quests, recentEvents, nemesis] =
    await Promise.all([
      buildCampaignMeta(client, campaignId),
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
    meta,
  };
}
