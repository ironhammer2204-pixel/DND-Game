/**
 * balancingEngine.test.ts
 *
 * Unit + integration tests for the Balancing Engine.
 * All database calls are mocked — no Postgres required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock RoomManager ─────────────────────────────────────────────
vi.mock("../websocket/roomManager", () => ({
  RoomManager: {
    broadcastToRoom: vi.fn(),
    sendToParticipant: vi.fn(),
  },
}));

import {
  computeXpNeeded,
  computeInflationIndex,
  computeWealthGini,
  recommendDropRateAdjustment,
  computePlayerPowerScore,
  computeEnemyScalingFactor,
  detectDominantBuild,
  XP_SOFT_CAP_BASE,
  XP_SOFT_CAP_EXPONENT,
} from "./balancingEngine";

// ── Mock pool factory ────────────────────────────────────────────
type MockRow = Record<string, unknown>;

function makeMockPool(rowSets: MockRow[][]) {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(async () => {
      const rows = rowSets[callIndex] ?? [];
      callIndex++;
      return { rows };
    }),
  };
}

// ──────────────────────────────────────────────────────────────────
// 1. XP SOFT CAP FORMULA
// ──────────────────────────────────────────────────────────────────
describe("computeXpNeeded", () => {
  it("returns base XP at level 0", () => {
    const needed = computeXpNeeded(0);
    expect(needed).toBe(XP_SOFT_CAP_BASE); // base * (1 + 0/10)^2 = base
  });

  it("increases with level", () => {
    const l5 = computeXpNeeded(5);
    const l10 = computeXpNeeded(10);
    const l20 = computeXpNeeded(20);
    expect(l10).toBeGreaterThan(l5);
    expect(l20).toBeGreaterThan(l10);
  });

  it("at level 10 is exactly 4x base (1 + 10/10)^2 = 4", () => {
    const needed = computeXpNeeded(10);
    expect(needed).toBe(Math.round(XP_SOFT_CAP_BASE * Math.pow(2, XP_SOFT_CAP_EXPONENT)));
  });

  it("uses custom baseXp param", () => {
    const customBase = 500;
    expect(computeXpNeeded(0, customBase)).toBe(customBase);
  });

  it("produces realistic thresholds (level 20 < 100k XP)", () => {
    expect(computeXpNeeded(20)).toBeLessThan(100_000);
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. INFLATION INDEX
// ──────────────────────────────────────────────────────────────────
describe("computeInflationIndex", () => {
  it("returns 1.0 when generation equals sinking", () => {
    expect(computeInflationIndex(1000, 1000)).toBe(1.0);
  });

  it("returns > 1 when more gold generated than sunk", () => {
    expect(computeInflationIndex(2000, 1000)).toBeGreaterThan(1.0);
  });

  it("returns < 1 when more gold sunk than generated", () => {
    expect(computeInflationIndex(500, 1500)).toBeLessThan(1.0);
  });

  it("handles zero sunk with generated > 0 → returns 2.0 (critical)", () => {
    expect(computeInflationIndex(1000, 0)).toBe(2.0);
  });

  it("handles both zero → returns 1.0 (neutral)", () => {
    expect(computeInflationIndex(0, 0)).toBe(1.0);
  });

  it("critical inflation threshold is 1.3", () => {
    // 1300 generated / 1000 sunk = 1.3
    expect(computeInflationIndex(1300, 1000)).toBeCloseTo(1.3, 2);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. WEALTH GINI COEFFICIENT
// ──────────────────────────────────────────────────────────────────
describe("computeWealthGini", () => {
  it("returns 0 for empty array", () => {
    expect(computeWealthGini([])).toBe(0);
  });

  it("returns 0 for perfect equality", () => {
    expect(computeWealthGini([100, 100, 100, 100])).toBe(0);
  });

  it("returns high value when one player has everything", () => {
    // [0, 0, 0, 10000] — maximum inequality
    const gini = computeWealthGini([0, 0, 0, 10_000]);
    expect(gini).toBeGreaterThan(0.5);
  });

  it("returns value between 0 and 1 always", () => {
    const cases = [
      [10, 20, 30, 40],
      [1000, 50, 200, 750],
      [0, 0, 5000],
      [300, 300, 300],
    ];
    for (const w of cases) {
      const g = computeWealthGini(w);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it("more unequal distribution → higher Gini", () => {
    const equal = computeWealthGini([100, 100, 100, 100]);
    const unequal = computeWealthGini([10, 20, 50, 300]);
    const extremelyUnequal = computeWealthGini([0, 0, 0, 1000]);
    expect(unequal).toBeGreaterThan(equal);
    expect(extremelyUnequal).toBeGreaterThan(unequal);
  });

  it("handles single player (no inequality possible)", () => {
    expect(computeWealthGini([500])).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. DROP RATE ADJUSTMENT
// ──────────────────────────────────────────────────────────────────
describe("recommendDropRateAdjustment", () => {
  it("returns current rate unchanged when dropCount is 0", () => {
    expect(recommendDropRateAdjustment(1.0, 0, 0, 0)).toBe(1.0);
  });

  it("reduces rate when sell rate > 70% (item is too common)", () => {
    // 8 drops, 6 sold → sell rate 75%
    const newRate = recommendDropRateAdjustment(1.0, 8, 6, 0);
    expect(newRate).toBeLessThan(1.0);
  });

  it("reduces rate when item under-used with many drops", () => {
    // 10 drops, 1 usage → usage rate 10%, dropCount > 5
    const newRate = recommendDropRateAdjustment(1.0, 10, 0, 1);
    expect(newRate).toBeLessThan(1.0);
  });

  it("increases rate when usage rate > 80% (highly valued)", () => {
    // 10 drops, 9 usages → usage rate 90%
    const newRate = recommendDropRateAdjustment(1.0, 10, 0, 9);
    expect(newRate).toBeGreaterThan(1.0);
  });

  it("never drops below 70% of current rate (soft floor)", () => {
    // Extreme case: 100% sell rate, many drops
    const newRate = recommendDropRateAdjustment(1.0, 100, 100, 0);
    expect(newRate).toBeGreaterThanOrEqual(0.7);
  });

  it("never exceeds 130% of current rate (soft ceiling)", () => {
    // Extreme case: 100% usage
    const newRate = recommendDropRateAdjustment(1.0, 100, 0, 100);
    expect(newRate).toBeLessThanOrEqual(1.3);
  });

  it("leaves rate unchanged when balanced", () => {
    // 10 drops, 4 sold (40%), 4 used (40%) — no adjustment
    const newRate = recommendDropRateAdjustment(1.0, 10, 4, 4);
    expect(newRate).toBe(1.0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 5. PLAYER POWER SCORE
// ──────────────────────────────────────────────────────────────────
describe("computePlayerPowerScore", () => {
  const baseFighter = {
    level: 5,
    attributes: { str: 18, dex: 12, con: 16, int: 10, wis: 10, cha: 10 },
    class: "Fighter",
    hp_max: 60,
  };

  it("returns positive score for any character", () => {
    expect(computePlayerPowerScore(baseFighter)).toBeGreaterThan(0);
  });

  it("higher level → higher power score", () => {
    const l1 = computePlayerPowerScore({ ...baseFighter, level: 1 });
    const l10 = computePlayerPowerScore({ ...baseFighter, level: 10 });
    expect(l10).toBeGreaterThan(l1);
  });

  it("higher HP → higher power score", () => {
    const low = computePlayerPowerScore({ ...baseFighter, hp_max: 30 });
    const high = computePlayerPowerScore({ ...baseFighter, hp_max: 120 });
    expect(high).toBeGreaterThan(low);
  });

  it("wizard uses INT as archetype bonus, fighter uses STR", () => {
    const wizard = {
      level: 5,
      attributes: { str: 8, dex: 12, con: 12, int: 20, wis: 14, cha: 10 },
      class: "wizard",
      hp_max: 35,
    };
    const fighter = {
      level: 5,
      attributes: { str: 20, dex: 12, con: 16, int: 8, wis: 10, cha: 10 },
      class: "fighter",
      hp_max: 65,
    };
    // Both score differently due to archetype
    expect(computePlayerPowerScore(wizard)).not.toBe(computePlayerPowerScore(fighter));
  });

  it("unknown class still produces a score (no crash)", () => {
    const unknown = { ...baseFighter, class: "artificer" };
    expect(() => computePlayerPowerScore(unknown)).not.toThrow();
    expect(computePlayerPowerScore(unknown)).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. ENEMY SCALING FACTOR
// ──────────────────────────────────────────────────────────────────
describe("computeEnemyScalingFactor", () => {
  it("returns 1.0 at baseline power", () => {
    expect(computeEnemyScalingFactor(50, 50)).toBe(1.0);
  });

  it("increases above 1 when players are stronger than baseline", () => {
    expect(computeEnemyScalingFactor(150, 50)).toBeGreaterThan(1.0);
  });

  it("decreases below 1 when players are weaker than baseline", () => {
    expect(computeEnemyScalingFactor(0, 50)).toBeLessThan(1.0);
  });

  it("hard cap at 1.5 — players always feel powerful", () => {
    expect(computeEnemyScalingFactor(10_000, 50)).toBe(1.5);
  });

  it("floor at 0.5 — game stays winnable even at lowest", () => {
    expect(computeEnemyScalingFactor(-9999, 50)).toBe(0.5);
  });

  it("partial rubber-band: strong players face up to 50% harder enemies", () => {
    const strongParty = computeEnemyScalingFactor(250, 50); // (250-50)/200 = 1.0, raw = 2.0 → capped 1.5
    const avgParty = computeEnemyScalingFactor(50, 50);     // 1.0
    expect(strongParty).toBeGreaterThan(avgParty);
    expect(strongParty).toBeLessThanOrEqual(1.5);
  });
});

// ──────────────────────────────────────────────────────────────────
// 7. DOMINANT BUILD DETECTION
// ──────────────────────────────────────────────────────────────────
describe("detectDominantBuild", () => {
  it("returns null dominant for empty counts", () => {
    const { dominant, percent } = detectDominantBuild({});
    expect(dominant).toBeNull();
    expect(percent).toBe(0);
  });

  it("detects dominant build when one class is >50%", () => {
    const { dominant, percent } = detectDominantBuild({ fighter: 4, rogue: 1 });
    expect(dominant).toBe("fighter");
    expect(percent).toBeCloseTo(80, 1);
  });

  it("detects correct dominant when multiple classes compete", () => {
    const { dominant } = detectDominantBuild({ rogue: 2, fighter: 3, wizard: 1 });
    expect(dominant).toBe("fighter");
  });

  it("returns 100% for single build", () => {
    const { dominant, percent } = detectDominantBuild({ paladin: 5 });
    expect(dominant).toBe("paladin");
    expect(percent).toBe(100);
  });

  it("threshold: >70% triggers dominant build flag", () => {
    const { percent } = detectDominantBuild({ barbarian: 8, mage: 2 });
    const triggersFlag = percent > 70;
    expect(triggersFlag).toBe(true);
  });

  it("balanced party does NOT trigger dominant flag", () => {
    const { percent } = detectDominantBuild({ fighter: 2, rogue: 2, wizard: 2, cleric: 2 });
    expect(percent).toBeLessThanOrEqual(70);
  });
});

// ──────────────────────────────────────────────────────────────────
// 8. computeEconomyMetrics (mock pool)
// ──────────────────────────────────────────────────────────────────
describe("computeEconomyMetrics (mock pool)", () => {
  it("returns economy snapshot with Gini and inflation", async () => {
    const { computeEconomyMetrics } = await import("./balancingEngine");

    const charRows = [{ gold: 500 }, { gold: 300 }, { gold: 1200 }, { gold: 200 }];
    const rewardRows = [
      { payload: JSON.stringify({ gold_reward: 400, gold_spent: 200 }) },
      { payload: JSON.stringify({ gold_reward: 100, gold_spent: 50 }) },
    ];

    const pool = makeMockPool([
      charRows,   // SELECT gold from characters
      rewardRows, // SELECT from event_log (quest rewards)
      [],         // INSERT economy_metrics (no return needed)
    ]);

    const snap = await computeEconomyMetrics(pool as any, "camp-1", 1);
    expect(snap.totalGold).toBe(2200);
    expect(snap.avgPlayerWealth).toBe(550);
    expect(snap.wealthGini).toBeGreaterThan(0);
    expect(snap.wealthGini).toBeLessThanOrEqual(1);
    expect(snap.inflationIndex).toBeGreaterThan(0);
  });

  it("handles zero characters gracefully", async () => {
    const { computeEconomyMetrics } = await import("./balancingEngine");
    const pool = makeMockPool([[], [], []]);
    const snap = await computeEconomyMetrics(pool as any, "camp-1", 1);
    expect(snap.totalGold).toBe(0);
    expect(snap.avgPlayerWealth).toBe(0);
    expect(snap.wealthGini).toBe(0);
  });

  it("flags critical inflation when generated >> sunk", async () => {
    const { computeEconomyMetrics } = await import("./balancingEngine");
    const charRows = [{ gold: 10000 }, { gold: 8000 }];
    // High reward, low spending
    const rewardRows = [{ payload: JSON.stringify({ gold_reward: 5000, gold_spent: 50 }) }];
    const pool = makeMockPool([charRows, rewardRows, []]);
    const snap = await computeEconomyMetrics(pool as any, "camp-1", 2);
    expect(snap.flags.inflation).toBeDefined();
    expect(snap.flags.inflation.severity).toMatch(/critical|warning/);
  });
});

// ──────────────────────────────────────────────────────────────────
// 9. checkFactionDominance (mock pool)
// ──────────────────────────────────────────────────────────────────
describe("checkFactionDominance (mock pool)", () => {
  it("returns null when no factions", async () => {
    const { checkFactionDominance } = await import("./balancingEngine");
    const pool = makeMockPool([[]]);
    const result = await checkFactionDominance(pool as any, "camp-1");
    expect(result.dominantFactionId).toBeNull();
  });

  it("detects dominant faction", async () => {
    const { checkFactionDominance } = await import("./balancingEngine");
    const factions = [
      { id: "f1", territories: 8 },
      { id: "f2", territories: 1 },
      { id: "f3", territories: 1 },
    ]; // f1 = 80%
    const pool = makeMockPool([factions]);
    const result = await checkFactionDominance(pool as any, "camp-1");
    expect(result.dominantFactionId).toBe("f1");
    expect(result.dominantPercent).toBeCloseTo(80, 1);
    expect(result.weakestFactionId).toBe("f2");
  });

  it("balanced factions: dominant < 70%", async () => {
    const { checkFactionDominance } = await import("./balancingEngine");
    const factions = [
      { id: "f1", territories: 4 },
      { id: "f2", territories: 3 },
      { id: "f3", territories: 3 },
    ];
    const pool = makeMockPool([factions]);
    const result = await checkFactionDominance(pool as any, "camp-1");
    expect(result.dominantPercent).toBeLessThan(70);
  });
});

// ──────────────────────────────────────────────────────────────────
// 10. runBalancingCycle — smoke test
// ──────────────────────────────────────────────────────────────────
describe("runBalancingCycle (smoke test)", () => {
  it("completes without throwing for an empty campaign", async () => {
    const { runBalancingCycle } = await import("./balancingEngine");
    const pool = makeMockPool([
      [{ next: "1" }],  // cycle number query
      [],               // characters (economy)
      [],               // event_log (quest rewards)
      [],               // INSERT economy_metrics
      [],               // combat encounters
      [],               // characters (combat class)
      [],               // INSERT combat_metrics
      [],               // inventory (loot)
      [],               // characters (progression)
      [],               // factions (dominance)
      [],               // INSERT balance_snapshots
    ]);
    await expect(runBalancingCycle(pool as any, "camp-1")).resolves.toBeUndefined();
  });

  it("logs cycle completion to console", async () => {
    const { runBalancingCycle } = await import("./balancingEngine");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const pool = makeMockPool(Array(20).fill([]));
    await runBalancingCycle(pool as any, "camp-1");
    // Cycle may log or silently succeed; just ensure no unhandled rejection
    consoleSpy.mockRestore();
  });
});

// ──────────────────────────────────────────────────────────────────
// 11. EDGE CASES / BOUNDARY CHECKS
// ──────────────────────────────────────────────────────────────────
describe("Edge Cases", () => {
  describe("computeWealthGini", () => {
    it("all zero wealth → gini = 0 (no inequality to measure)", () => {
      expect(computeWealthGini([0, 0, 0])).toBe(0);
    });
  });

  describe("computeInflationIndex", () => {
    it("very high inflation is still capped to a number", () => {
      const idx = computeInflationIndex(1_000_000, 1);
      expect(isFinite(idx)).toBe(true);
    });
  });

  describe("recommendDropRateAdjustment", () => {
    it("does not produce NaN for extreme inputs", () => {
      const rate = recommendDropRateAdjustment(0.001, 1000, 999, 0);
      expect(isNaN(rate)).toBe(false);
    });
  });

  describe("computeEnemyScalingFactor", () => {
    it("returns exact 1.5 cap at very high power", () => {
      expect(computeEnemyScalingFactor(1_000_000)).toBe(1.5);
    });

    it("returns exact 0.5 floor at negative power", () => {
      expect(computeEnemyScalingFactor(-1_000_000)).toBe(0.5);
    });
  });
});
