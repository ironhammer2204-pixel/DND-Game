import { Pool, PoolClient } from "pg";
import { RoomManager } from "../websocket/roomManager";

type Client = Pool | PoolClient;

// ============================================================
// SOFT CAP CONFIG
// ============================================================

/** XP needed = base * (1 + level / 10)² */
export const XP_SOFT_CAP_BASE = 300;
export const XP_SOFT_CAP_EXPONENT = 2;

export function computeXpNeeded(level: number, baseXp = XP_SOFT_CAP_BASE): number {
  return Math.round(baseXp * Math.pow(1 + level / 10, XP_SOFT_CAP_EXPONENT));
}

// ============================================================
// ECONOMY BALANCING
// ============================================================

interface EconomySnapshot {
  campaignId: string;
  cycleNumber: number;
  totalGold: number;
  goldGenerated: number;
  goldSunk: number;
  inflationIndex: number;
  avgPlayerWealth: number;
  wealthGini: number;
  flags: Record<string, Record<string, unknown>>;
  recommendations: Record<string, string>;
}

/**
 * Compute inflation index: ratio of gold generated vs gold sunk this cycle.
 * > 1.2 = warning, > 1.3 = critical.
 */
export function computeInflationIndex(goldGenerated: number, goldSunk: number): number {
  if (goldSunk === 0) return goldGenerated > 0 ? 2.0 : 1.0;
  return goldGenerated / goldSunk;
}

/**
 * Compute Gini coefficient for player wealth distribution.
 * 0 = perfect equality, 1 = one player has everything.
 */
export function computeWealthGini(wealthValues: number[]): number {
  if (wealthValues.length === 0) return 0;
  const sorted = [...wealthValues].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;

  let sumAbsDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumAbsDiff += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return sumAbsDiff / (2 * n * n * mean);
}

export async function computeEconomyMetrics(
  client: Client,
  campaignId: string,
  cycleNumber: number
): Promise<EconomySnapshot> {
  // Fetch all character gold
  const charRes = await client.query(
    "SELECT gold FROM public.characters WHERE campaign_id = $1 AND is_alive = true",
    [campaignId]
  );
  const wealthValues: number[] = charRes.rows.map((r: { gold: number }) => r.gold ?? 0);
  const totalGold = wealthValues.reduce((s, v) => s + v, 0);
  const avgPlayerWealth = wealthValues.length > 0 ? Math.round(totalGold / wealthValues.length) : 0;
  const wealthGini = computeWealthGini(wealthValues);

  // Estimate gold generated and sunk from dice rolls / rewards in recent events
  const rewardRes = await client.query(
    `SELECT payload FROM public.event_log
     WHERE campaign_id = $1 AND type = 'quest' AND created_at > now() - interval '1 day'`,
    [campaignId]
  );
  let goldGenerated = 0;
  let goldSunk = 0;
  for (const row of rewardRes.rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    goldGenerated += payload.gold_reward ?? 0;
    goldSunk += payload.gold_spent ?? 0;
  }

  const inflationIndex = computeInflationIndex(goldGenerated + 100, goldSunk + 100); // +100 to avoid divide by zero

  const flags: Record<string, Record<string, unknown>> = {};
  const recommendations: Record<string, string> = {};

  if (inflationIndex > 1.3) {
    flags.inflation = { severity: "critical", value: inflationIndex };
    recommendations.gold_sinks = "Increase NPC prices 10%, add guild fees, raise repair costs";
    // Auto-apply: update campaign world_state price multiplier
    await client.query(
      `UPDATE public.campaigns
       SET world_state = jsonb_set(coalesce(world_state,'{}'), '{price_multiplier}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(1.1), campaignId]
    );
  } else if (inflationIndex > 1.2) {
    flags.inflation = { severity: "warning", value: inflationIndex };
    recommendations.gold_sinks = "Consider adding minor economic sinks";
  }

  if (wealthGini > 0.6) {
    flags.wealth_inequality = { severity: "warning", gini: wealthGini };
    recommendations.wealth_distribution = "One player may be hoarding gold; consider redistribution quests";
  }

  // Write to economy_metrics table
  await client.query(
    `INSERT INTO public.economy_metrics
     (campaign_id, cycle_number, total_gold_in_circulation, gold_generated_this_cycle,
      gold_sunk_this_cycle, inflation_index, avg_player_wealth, wealth_gini)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [campaignId, cycleNumber, totalGold, goldGenerated, goldSunk, inflationIndex, avgPlayerWealth, wealthGini]
  );

  return {
    campaignId, cycleNumber, totalGold, goldGenerated, goldSunk,
    inflationIndex, avgPlayerWealth, wealthGini, flags, recommendations,
  };
}

export function recommendGoldSinks(snapshot: EconomySnapshot): string[] {
  const recs: string[] = [];
  if (snapshot.inflationIndex > 1.2) {
    recs.push("Raise NPC merchant prices by 10%");
    recs.push("Increase dungeon repair/crafting costs");
  }
  if (snapshot.wealthGini > 0.6) {
    recs.push("Add wealth redistribution quest (rob the rich, protect the poor)");
  }
  return recs;
}

// ============================================================
// COMBAT BALANCING
// ============================================================

interface CombatSnapshot {
  campaignId: string;
  cycleNumber: number;
  avgDurationRounds: number;
  avgPlayerDPR: number;
  avgEnemyDPR: number;
  winRate: number;
  deathRate: number;
  dominantBuildPercent: number;
  sessionsSampled: number;
  flags: Record<string, Record<string, unknown>>;
  recommendations: Record<string, string>;
}

/**
 * Weighted player power score.
 * Factors: level, attack_bonus, hp_max, and rough class archetype.
 */
export function computePlayerPowerScore(character: {
  level: number;
  attributes: Record<string, number>;
  class: string;
  hp_max: number;
}): number {
  const { level, attributes, class: cls, hp_max } = character;

  // Build archetype weights
  const tankClasses = ["fighter", "paladin", "barbarian", "cleric"];
  const casterClasses = ["wizard", "sorcerer", "warlock", "druid"];
  const dexClasses = ["rogue", "ranger", "monk", "bard"];

  let archetypeBonus = 0;
  const classLower = cls.toLowerCase();
  if (tankClasses.includes(classLower)) archetypeBonus = attributes.str * 0.5;
  else if (casterClasses.includes(classLower)) archetypeBonus = attributes.int * 0.5;
  else if (dexClasses.includes(classLower)) archetypeBonus = attributes.dex * 0.5;

  return level * 10 + hp_max * 0.5 + archetypeBonus;
}

/**
 * Enemy scaling factor — partial rubber-band. Never full.
 * base × (1 + (playerPower - baseline) / 200)
 * Capped at ×1.5 so players always feel stronger.
 */
export function computeEnemyScalingFactor(avgPlayerPower: number, baseline = 50): number {
  const raw = 1 + (avgPlayerPower - baseline) / 200;
  return Math.min(1.5, Math.max(0.5, raw));
}

export function detectDominantBuild(buildCounts: Record<string, number>): {
  dominant: string | null;
  percent: number;
} {
  const total = Object.values(buildCounts).reduce((s, v) => s + v, 0);
  if (total === 0) return { dominant: null, percent: 0 };

  let maxCount = 0;
  let maxBuild = "";
  for (const [build, count] of Object.entries(buildCounts)) {
    if (count > maxCount) { maxCount = count; maxBuild = build; }
  }

  return { dominant: maxBuild || null, percent: total > 0 ? (maxCount / total) * 100 : 0 };
}

export async function computeCombatMetrics(
  client: Client,
  campaignId: string,
  cycleNumber: number,
  lastNSessions = 5
): Promise<CombatSnapshot> {
  // Sample recent combat encounters
  const encounterRes = await client.query(
    `SELECT participants, round_number FROM public.combat_encounters
     WHERE campaign_id = $1 AND status = 'resolved'
     ORDER BY started_at DESC LIMIT $2`,
    [campaignId, lastNSessions]
  );

  let totalRounds = 0;
  let winCount = 0;
  let deathCount = 0;
  const buildCounts: Record<string, number> = {};
  const sessions = encounterRes.rows.length;

  for (const row of encounterRes.rows) {
    const participants = typeof row.participants === "string"
      ? JSON.parse(row.participants)
      : row.participants ?? [];

    totalRounds += row.round_number ?? 0;

    // Determine win: at least one player alive, all enemies dead
    const players = participants.filter((p: { type: string }) => p.type === "player");
    const enemies = participants.filter((p: { type: string }) => p.type === "enemy");
    const playersAlive = players.filter((p: { hp_current: number }) => p.hp_current > 0).length;
    const enemiesAlive = enemies.filter((p: { hp_current: number }) => p.hp_current > 0).length;

    if (playersAlive > 0 && enemiesAlive === 0) winCount++;

    // Count deaths
    for (const player of players) {
      if (player.hp_current <= 0) deathCount++;
    }
  }

  // Count character classes for build distribution
  const charRes = await client.query(
    "SELECT class FROM public.characters WHERE campaign_id = $1 AND is_alive = true",
    [campaignId]
  );
  for (const row of charRes.rows) {
    const cls = (row.class || "unknown").toLowerCase();
    buildCounts[cls] = (buildCounts[cls] ?? 0) + 1;
  }

  const avgDurationRounds = sessions > 0 ? totalRounds / sessions : 0;
  const winRate = sessions > 0 ? winCount / sessions : 0.5;
  const deathRate = sessions > 0 ? deathCount / sessions : 0;
  const { dominant, percent: dominantBuildPercent } = detectDominantBuild(buildCounts);

  const flags: Record<string, Record<string, unknown>> = {};
  const recommendations: Record<string, string> = {};

  if (winRate > 0.9 && sessions >= 3) {
    flags.combat_too_easy = { win_rate: winRate };
    recommendations.difficulty = "Party winning too easily — scale up enemy HP or add Elite enemy variants";
  } else if (winRate < 0.3 && sessions >= 3) {
    flags.combat_too_hard = { win_rate: winRate };
    recommendations.difficulty = "Party losing consistently — reduce enemy count or increase ally support";
  }

  if (dominantBuildPercent > 70 && dominant) {
    flags.dominant_build = { build: dominant, percent: dominantBuildPercent };
    recommendations.build_diversity = `${dominant} is dominant (${dominantBuildPercent.toFixed(0)}%) — consider introducing encounters that counter this build`;
  }

  await client.query(
    `INSERT INTO public.combat_metrics
     (campaign_id, cycle_number, avg_combat_duration_rounds, avg_player_damage_per_round,
      avg_enemy_damage_per_round, win_rate, death_rate, most_used_build_types, dominant_build_percent, sessions_sampled)
     VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, $8)`,
    [campaignId, cycleNumber, avgDurationRounds, winRate, deathRate, JSON.stringify(buildCounts), dominantBuildPercent, sessions]
  );

  return {
    campaignId, cycleNumber, avgDurationRounds, avgPlayerDPR: 0, avgEnemyDPR: 0,
    winRate, deathRate, dominantBuildPercent, sessionsSampled: sessions, flags, recommendations,
  };
}

// ============================================================
// LOOT BALANCING
// ============================================================

interface LootSnapshot {
  itemId: string;
  dropCount: number;
  usageCount: number;
  sellCount: number;
  currentDropRate: number;
  recommendedDropRate: number;
}

/**
 * Adjust drop rate by at most ±30% from base per cycle.
 * If sell rate > 70%, item is too common → reduce.
 * If usage rate < 20% and drop count > 5 → item underused → reduce.
 */
export function recommendDropRateAdjustment(
  currentRate: number,
  dropCount: number,
  sellCount: number,
  usageCount: number
): number {
  if (dropCount === 0) return currentRate;
  const sellRate = sellCount / dropCount;
  const usageRate = usageCount / dropCount;

  let adjustment = 0;
  if (sellRate > 0.7) adjustment = -0.15; // Too common
  else if (usageRate < 0.2 && dropCount > 5) adjustment = -0.1; // Under-used
  else if (usageRate > 0.8) adjustment = +0.05; // Highly valued

  // Cap adjustment at ±30%
  const newRate = currentRate * (1 + adjustment);
  const maxRate = currentRate * 1.3;
  const minRate = currentRate * 0.7;
  return Math.max(minRate, Math.min(maxRate, newRate));
}

export async function computeLootMetrics(
  client: Client,
  campaignId: string,
  cycleNumber: number
): Promise<LootSnapshot[]> {
  // Aggregate inventory data
  const inventoryRes = await client.query(
    `SELECT ii.item_id, count(*)::int AS drop_count, sum(ii.quantity)::int AS qty,
            count(CASE WHEN ii.is_equipped THEN 1 END)::int AS usage_count
     FROM public.inventory_items ii
     JOIN public.characters c ON c.id = ii.character_id
     WHERE c.campaign_id = $1
     GROUP BY ii.item_id`,
    [campaignId]
  );

  const snapshots: LootSnapshot[] = [];

  for (const row of inventoryRes.rows) {
    const currentDropRate = 1.0; // Default base rate (we don't store drop rates, so we use relative adjustment)
    const recommended = recommendDropRateAdjustment(
      currentDropRate,
      row.drop_count ?? 0,
      0, // sell_count not tracked in inventory (item removed when sold) — approximate as 0
      row.usage_count ?? 0
    );

    await client.query(
      `INSERT INTO public.loot_metrics
       (campaign_id, cycle_number, item_id, drop_count, usage_count, sell_count, current_drop_rate, recommended_drop_rate)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
      [campaignId, cycleNumber, row.item_id, row.drop_count, row.usage_count, currentDropRate, recommended]
    );

    snapshots.push({
      itemId: row.item_id,
      dropCount: row.drop_count,
      usageCount: row.usage_count,
      sellCount: 0,
      currentDropRate,
      recommendedDropRate: recommended,
    });
  }

  return snapshots;
}

// ============================================================
// FACTION RUBBER-BANDING
// ============================================================

/**
 * Checks if one faction controls > 70% of all territories.
 */
export async function checkFactionDominance(
  client: Client,
  campaignId: string
): Promise<{ dominantFactionId: string | null; dominantPercent: number; weakestFactionId: string | null }> {
  const factionsRes = await client.query(
    "SELECT id, territories FROM public.factions WHERE campaign_id = $1 AND collapsed = false",
    [campaignId]
  );

  if (factionsRes.rows.length === 0) return { dominantFactionId: null, dominantPercent: 0, weakestFactionId: null };

  const totalTerritories = factionsRes.rows.reduce((s: number, r: { territories: number }) => s + (r.territories ?? 0), 0);
  if (totalTerritories === 0) return { dominantFactionId: null, dominantPercent: 0, weakestFactionId: null };

  let maxTerr = -1;
  let dominantFactionId: string | null = null;
  let minTerr = Infinity;
  let weakestFactionId: string | null = null;

  for (const row of factionsRes.rows) {
    const t = row.territories ?? 0;
    if (t > maxTerr) { maxTerr = t; dominantFactionId = row.id; }
    if (t < minTerr) { minTerr = t; weakestFactionId = row.id; }
  }

  const dominantPercent = dominantFactionId ? (maxTerr / totalTerritories) * 100 : 0;
  return { dominantFactionId, dominantPercent, weakestFactionId };
}

/**
 * Applies rubber-band modifiers:
 * Dominant: +10 corruption/cycle, +5% rebellion chance, -10% PP generation
 * Weakest: +10% PP generation, +5 stability, +5 recruitment bonus
 */
export async function applyRubberBandEffects(
  client: Client,
  campaignId: string,
  dominantFactionId: string,
  weakestFactionId: string | null
): Promise<void> {
  // Dominant faction: apply corruption (reduce stability) and decrease PP generation via pressure cap
  await client.query(
    `UPDATE public.factions
     SET stability = GREATEST(0, stability - 10),
         pressure_cap = GREATEST(100, pressure_cap - ROUND(pressure_cap * 0.1))
     WHERE id = $1`,
    [dominantFactionId]
  );

  // Weakest faction: boost stability and PP cap
  if (weakestFactionId) {
    await client.query(
      `UPDATE public.factions
       SET stability = LEAST(100, stability + 5),
           pressure_cap = pressure_cap + ROUND(pressure_cap * 0.1)
       WHERE id = $1`,
      [weakestFactionId]
    );
  }

  console.log(`[balancingEngine] Rubber-band applied: dominant=${dominantFactionId}, weakest=${weakestFactionId ?? "none"}`);
}

// ============================================================
// PROGRESSION METRICS
// ============================================================

export async function computeProgressionMetrics(
  client: Client,
  campaignId: string,
  cycleNumber: number
): Promise<void> {
  const charRes = await client.query(
    "SELECT level, xp FROM public.characters WHERE campaign_id = $1 AND is_alive = true",
    [campaignId]
  );

  if (charRes.rows.length === 0) return;

  const levels: number[] = charRes.rows.map((r: { level: number }) => r.level ?? 1);
  const avgLevel = levels.reduce((s, v) => s + v, 0) / levels.length;

  const levelDist: Record<string, number> = {};
  for (const l of levels) {
    const key = String(l);
    levelDist[key] = (levelDist[key] ?? 0) + 1;
  }

  const softCapTriggers: Record<string, Record<string, unknown>> = {};
  for (const row of charRes.rows) {
    const needed = computeXpNeeded(row.level ?? 1);
    if ((row.xp ?? 0) > needed * 0.8) {
      softCapTriggers[row.level] = { xp: row.xp, threshold: needed };
    }
  }

  await client.query(
    `INSERT INTO public.progression_metrics
     (campaign_id, cycle_number, avg_character_level, xp_per_session_avg, level_distribution, soft_cap_triggers)
     VALUES ($1, $2, $3, 0, $4, $5)`,
    [campaignId, cycleNumber, avgLevel, JSON.stringify(levelDist), JSON.stringify(softCapTriggers)]
  );
}

// ============================================================
// ORCHESTRATOR — Full Balancing Cycle
// ============================================================

/**
 * Runs all balancing sub-systems and writes a consolidated balance_snapshot.
 * Called every real hour from the server timer.
 */
export async function runBalancingCycle(client: Client, campaignId: string): Promise<void> {
  try {
    // Get next cycle number
    const cycleRes = await client.query(
      "SELECT coalesce(max(cycle_number), 0) + 1 AS next FROM public.economy_metrics WHERE campaign_id = $1",
      [campaignId]
    );
    const cycleNumber: number = parseInt(cycleRes.rows[0]?.next ?? "1", 10);

    // Run all metric engines
    const [economy, combat] = await Promise.all([
      computeEconomyMetrics(client, campaignId, cycleNumber),
      computeCombatMetrics(client, campaignId, cycleNumber),
    ]);

    await computeLootMetrics(client, campaignId, cycleNumber);
    await computeProgressionMetrics(client, campaignId, cycleNumber);

    // Faction rubber-banding
    const { dominantFactionId, dominantPercent, weakestFactionId } = await checkFactionDominance(client, campaignId);
    if (dominantFactionId && dominantPercent > 70) {
      await applyRubberBandEffects(client, campaignId, dominantFactionId, weakestFactionId);
    }

    // Aggregate flags and recommendations
    const allFlags = { ...economy.flags, ...combat.flags };
    const allRecs = { ...economy.recommendations, ...combat.recommendations };
    if (dominantFactionId && dominantPercent > 70) {
      allFlags.faction_dominance = { faction_id: dominantFactionId, percent: dominantPercent };
      allRecs.faction = "Dominant faction rubber-band applied automatically";
    }

    // Write consolidated snapshot
    await client.query(
      `INSERT INTO public.balance_snapshots
       (campaign_id, snapshot_type, data, flags, recommendations)
       VALUES ($1, 'economy', $2, $3, $4)`,
      [
        campaignId,
        JSON.stringify({
          cycle: cycleNumber,
          economy: {
            inflation: economy.inflationIndex,
            gini: economy.wealthGini,
            total_gold: economy.totalGold,
          },
          combat: {
            win_rate: combat.winRate,
            death_rate: combat.deathRate,
            dominant_build_pct: combat.dominantBuildPercent,
          },
          faction: { dominant_percent: dominantPercent },
        }),
        JSON.stringify(allFlags),
        JSON.stringify(allRecs),
      ]
    );

    console.log(`[balancingEngine] Cycle ${cycleNumber} complete for campaign ${campaignId}`);
  } catch (err: unknown) {
    console.error("[balancingEngine] runBalancingCycle error:", err instanceof Error ? err.message : String(err));
  }
}
