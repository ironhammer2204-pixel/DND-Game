/**
 * randomEventEngine.ts
 *
 * Randomness engine for world events, weather, time, encounters, and shop restocks.
 * Fires during world heartbeat ticks and player actions.
 */

import { Pool, PoolClient } from "pg";
import { rollDie, d20, d6, d4 } from "./diceEngine";
import { RoomManager } from "../websocket/roomManager";

// ============================================================
// WEATHER SYSTEM
// ============================================================

export type WeatherState = "clear" | "overcast" | "rain" | "storm" | "fog" | "blizzard" | "heatwave";

const WEATHER_TRANSITIONS: Record<WeatherState, WeatherState[]> = {
  clear: ["clear", "overcast", "heatwave"],
  overcast: ["overcast", "clear", "rain", "fog"],
  rain: ["rain", "overcast", "storm", "clear"],
  storm: ["storm", "rain", "overcast"],
  fog: ["fog", "overcast", "clear", "rain"],
  blizzard: ["blizzard", "overcast", "clear"],
  heatwave: ["heatwave", "clear", "overcast"],
};

/**
 * Advance weather. Each session/day: roll d6, 1-2 = change, 3-6 = same.
 */
export function advanceWeather(currentWeather: WeatherState): WeatherState {
  const roll = d6();
  if (roll <= 2) {
    const options = WEATHER_TRANSITIONS[currentWeather] || ["clear"];
    return options[rollDie(options.length) - 1];
  }
  return currentWeather;
}

/**
 * Weather effects on skill checks.
 */
export function getWeatherEffects(weather: WeatherState): {
  perceptionDisadvantage: boolean;
  rangedDisadvantage: boolean;
  stealthAdvantage: boolean;
  movementPenalty: number; // percentage
} {
  switch (weather) {
    case "fog":
      return { perceptionDisadvantage: true, rangedDisadvantage: true, stealthAdvantage: true, movementPenalty: 10 };
    case "rain":
      return { perceptionDisadvantage: false, rangedDisadvantage: true, stealthAdvantage: false, movementPenalty: 10 };
    case "storm":
      return { perceptionDisadvantage: true, rangedDisadvantage: true, stealthAdvantage: false, movementPenalty: 25 };
    case "blizzard":
      return { perceptionDisadvantage: true, rangedDisadvantage: true, stealthAdvantage: true, movementPenalty: 50 };
    case "heatwave":
      return { perceptionDisadvantage: false, rangedDisadvantage: false, stealthAdvantage: false, movementPenalty: 10 };
    default:
      return { perceptionDisadvantage: false, rangedDisadvantage: false, stealthAdvantage: false, movementPenalty: 0 };
  }
}

// ============================================================
// TIME OF DAY
// ============================================================

export type TimeOfDay = "dawn" | "morning" | "midday" | "afternoon" | "dusk" | "night" | "deep_night";

const TIME_ORDER: TimeOfDay[] = ["dawn", "morning", "midday", "afternoon", "dusk", "night", "deep_night"];

export function advanceTimeOfDay(current: TimeOfDay, hoursElapsed = 4): TimeOfDay {
  const idx = TIME_ORDER.indexOf(current);
  if (idx === -1) return "morning";
  const steps = Math.floor(hoursElapsed / 4);
  return TIME_ORDER[(idx + steps) % TIME_ORDER.length];
}

/**
 * Time effects on gameplay.
 */
export function getTimeEffects(time: TimeOfDay): {
  perceptionDisadvantage: boolean;
  stealthAdvantage: boolean;
  darkvisionRequired: boolean;
} {
  switch (time) {
    case "dusk":
      return { perceptionDisadvantage: true, stealthAdvantage: true, darkvisionRequired: false };
    case "night":
      return { perceptionDisadvantage: true, stealthAdvantage: true, darkvisionRequired: true };
    case "deep_night":
      return { perceptionDisadvantage: true, stealthAdvantage: true, darkvisionRequired: true };
    default:
      return { perceptionDisadvantage: false, stealthAdvantage: false, darkvisionRequired: false };
  }
}

// ============================================================
// RANDOM ENCOUNTER TABLE
// ============================================================

export function shouldTriggerEncounter(dangerLevel: string, diceRoll?: number): boolean {
  const roll = diceRoll ?? d20();
  switch (dangerLevel) {
    case "safe": return false;
    case "low": return roll >= 18;
    case "medium": return roll >= 14;
    case "high": return roll >= 10;
    case "deadly": return roll >= 6;
    default: return roll >= 14;
  }
}

// ============================================================
// RANDOM WORLD EVENTS
// ============================================================

export async function tickRandomEvent(
  client: PoolClient | Pool,
  campaignId: string
): Promise<{ triggered: boolean; event?: string; seed?: string }> {
  const roll = d20();
  if (roll < 18) {
    return { triggered: false };
  }

  // Fetch random event seeds from world_state
  const campaignRes = await client.query(
    "SELECT world_state FROM public.campaigns WHERE id = $1",
    [campaignId]
  );
  if (campaignRes.rows.length === 0) return { triggered: false };

  const worldState = campaignRes.rows[0].world_state || {};
  const seeds: string[] = worldState.random_event_seeds || [];

  if (seeds.length === 0) return { triggered: false };

  // Pick and consume a seed
  const seedIndex = rollDie(seeds.length) - 1;
  const seed = seeds[seedIndex];
  const remaining = seeds.filter((_, i) => i !== seedIndex);

  // Log to event_log
  const logRes = await client.query(
    `INSERT INTO public.event_log (campaign_id, type, payload)
     VALUES ($1, 'system', $2)
     RETURNING id, created_at`,
    [
      campaignId,
      JSON.stringify({ action_type: "world_event", text: seed }),
    ]
  );

  // Update world_state (consume seed)
  await client.query(
    "UPDATE public.campaigns SET world_state = jsonb_set(world_state, '{random_event_seeds}', $1::jsonb) WHERE id = $2",
    [JSON.stringify(remaining), campaignId]
  );

  // Broadcast
  try {
    RoomManager.broadcastToRoom(campaignId, "WORLD_EVENT", {
      event_id: logRes.rows[0].id,
      text: seed,
      timestamp: logRes.rows[0].created_at,
    });
  } catch (err: unknown) {
    console.error("[randomEventEngine] broadcast failed:", err instanceof Error ? err.message : String(err));
  }

  return { triggered: true, event: seed, seed };
}

// ============================================================
// NPC MOOD SHIFT
// ============================================================

export async function tickNpcMoodShifts(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  const roll = d6();
  if (roll < 5) return; // Only shift on 5-6

  const npcsRes = await client.query(
    "SELECT id, relationship_map FROM public.npcs WHERE campaign_id = $1 AND is_alive = true",
    [campaignId]
  );

  for (const npc of npcsRes.rows) {
    const map = npc.relationship_map || {};
    const keys = Object.keys(map);
    if (keys.length === 0) continue;

    // Shift one random relationship by +/- 5
    const targetKey = keys[rollDie(keys.length) - 1];
    const shift = rollDie(2) === 1 ? -5 : 5;
    map[targetKey] = Math.max(-100, Math.min(100, (map[targetKey] || 0) + shift));

    await client.query(
      "UPDATE public.npcs SET relationship_map = $1 WHERE id = $2",
      [JSON.stringify(map), npc.id]
    );
  }
}

// ============================================================
// SHOP RESTOCK
// ============================================================

export async function tickShopRestock(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  // Simple implementation: every 4 ticks (days), restock shops
  // In a full implementation, track last_restock per shop
  const campaignRes = await client.query(
    "SELECT world_state FROM public.campaigns WHERE id = $1",
    [campaignId]
  );
  const worldState = campaignRes.rows[0]?.world_state || {};
  const day = (worldState.campaign_day || 0) + 1;

  if (day % 4 === 0) {
    await client.query(
      `UPDATE public.campaigns
       SET world_state = jsonb_set(world_state, '{shop_restock_day}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(day), campaignId]
    );

    try {
      RoomManager.broadcastToRoom(campaignId, "WORLD_EVENT", {
        event_id: `shop-restock-${day}`,
        text: "Merchants have restocked their wares.",
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      console.error("[randomEventEngine] shop restock broadcast failed:", err instanceof Error ? err.message : String(err));
    }
  }
}

// ============================================================
// FULL HEARTBEAT TICK
// ============================================================

export async function runRandomEventTick(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  try {
    // 1. Random event
    await tickRandomEvent(client, campaignId);

    // 2. NPC mood shifts
    await tickNpcMoodShifts(client, campaignId);

    // 3. Shop restock
    await tickShopRestock(client, campaignId);

    // 4. Advance time and weather (if enough time passed)
    const campaignRes = await client.query(
      "SELECT world_state FROM public.campaigns WHERE id = $1",
      [campaignId]
    );
    const worldState = campaignRes.rows[0]?.world_state || {};

    const currentWeather: WeatherState = worldState.current_weather || "clear";
    const currentTime: TimeOfDay = worldState.time_of_day || "morning";
    const currentDay = worldState.campaign_day || 1;

    const newWeather = advanceWeather(currentWeather);
    const newTime = advanceTimeOfDay(currentTime, 4);
    const newDay = newTime === "dawn" ? currentDay + 1 : currentDay;

    const weatherEffects = getWeatherEffects(newWeather);
    const timeEffects = getTimeEffects(newTime);

    await client.query(
      `UPDATE public.campaigns
       SET world_state = world_state || $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          current_weather: newWeather,
          time_of_day: newTime,
          campaign_day: newDay,
          weather_effects: weatherEffects,
          time_effects: timeEffects,
        }),
        campaignId,
      ]
    );

    // Broadcast world state update
    try {
      RoomManager.broadcastToRoom(campaignId, "WORLD_STATE_UPDATE", {
        weather: newWeather,
        time_of_day: newTime,
        campaign_day: newDay,
        weather_effects: weatherEffects,
        time_effects: timeEffects,
      });
    } catch (err: unknown) {
      console.error("[randomEventEngine] world state broadcast failed:", err instanceof Error ? err.message : String(err));
    }
  } catch (err: unknown) {
    console.error("[randomEventEngine] tick failed:", err instanceof Error ? err.message : String(err));
  }
}
