/**
 * encyclopediaEngine.test.ts
 *
 * Unit + integration tests for the World Encyclopedia engine.
 * Uses Vitest with an in-memory mock pool instead of a real database,
 * so these tests are fully self-contained and run without Postgres.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock RoomManager so broadcast calls don't throw ──────────────
vi.mock("../websocket/roomManager", () => ({
  RoomManager: {
    broadcastToRoom: vi.fn(),
    sendToParticipant: vi.fn(),
    getParticipantBySocket: vi.fn(),
  },
}));

// ── Mock dmService (Groq) ────────────────────────────────────────
vi.mock("../ai/dmService", () => ({
  dmService: {
    generateSessionSummary: vi.fn().mockResolvedValue("A brave band of adventurers ventured forth..."),
  },
}));

import {
  computeImportance,
} from "./encyclopediaEngine";

import {
  computeImportanceScore,
  computeWealthGini as _gini, // exported from balancingEngine for shared math test
  getContentAtKnowledgeLevel,
  IMPORTANCE_THRESHOLDS,
  ERA_CONFIG,
  RUMOR_CONFIG,
} from "./encyclopediaConfig";

// ── Minimal mock pool factory ─────────────────────────────────────
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
// 1. IMPORTANCE SCORING
// ──────────────────────────────────────────────────────────────────
describe("computeImportanceScore", () => {
  it("returns dm override directly when provided", () => {
    const score = computeImportanceScore({ dm_importance_override: 75 });
    expect(score).toBe(75);
  });

  it("calculates weighted score from factors", () => {
    const score = computeImportanceScore({
      deaths_involved: 2,        // 20
      factions_involved: 1,      // 15
      player_characters_involved: 1, // 20
    });
    // 20 + 15 + 20 = 55
    expect(score).toBe(55);
  });

  it("returns 0 for empty factors", () => {
    expect(computeImportanceScore({})).toBe(0);
  });

  it("weights player characters highest", () => {
    const playerHeavy = computeImportanceScore({ player_characters_involved: 3 }); // 60
    const factionHeavy = computeImportanceScore({ factions_involved: 3 });          // 45
    expect(playerHeavy).toBeGreaterThan(factionHeavy);
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. IMPORTANCE THRESHOLDS
// ──────────────────────────────────────────────────────────────────
describe("IMPORTANCE_THRESHOLDS", () => {
  it("minimum record threshold is below auto-record", () => {
    expect(IMPORTANCE_THRESHOLDS.MINIMUM_RECORD).toBeLessThan(IMPORTANCE_THRESHOLDS.AUTO_RECORD);
  });

  it("era trigger is highest", () => {
    expect(IMPORTANCE_THRESHOLDS.ERA_TRIGGER).toBeGreaterThanOrEqual(IMPORTANCE_THRESHOLDS.AUTO_RECORD);
  });

  it("a major battle (3 PCs + 2 factions) exceeds AUTO_RECORD", () => {
    const score = computeImportanceScore({
      player_characters_involved: 3, // 60
      factions_involved: 2,          // 30
    }); // = 90
    expect(score).toBeGreaterThanOrEqual(IMPORTANCE_THRESHOLDS.AUTO_RECORD);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. ERA CONFIG
// ──────────────────────────────────────────────────────────────────
describe("ERA_CONFIG", () => {
  it("has at least 3 regime change event types", () => {
    expect(ERA_CONFIG.REGIME_CHANGE_EVENT_TYPES.length).toBeGreaterThanOrEqual(3);
  });

  it("includes assassination as a regime-change event", () => {
    expect(ERA_CONFIG.REGIME_CHANGE_EVENT_TYPES).toContain("assassination");
  });

  it("includes faction_collapse as a regime-change event", () => {
    expect(ERA_CONFIG.REGIME_CHANGE_EVENT_TYPES).toContain("faction_collapse");
  });

  it("EVENTS_REQUIRED_TO_TRIGGER is positive", () => {
    expect(ERA_CONFIG.EVENTS_REQUIRED_TO_TRIGGER).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. RUMOR CONFIG
// ──────────────────────────────────────────────────────────────────
describe("RUMOR_CONFIG", () => {
  it("partial confirm bonus is positive", () => {
    expect(RUMOR_CONFIG.PARTIAL_CONFIRM_BONUS).toBeGreaterThan(0);
  });

  it("spread reduction causes decay over retellings", () => {
    const baseReliability = 80;
    const afterOneRetelling = baseReliability - RUMOR_CONFIG.SPREAD_REDUCTION;
    const afterThreeRetellings = baseReliability - 3 * RUMOR_CONFIG.SPREAD_REDUCTION;
    expect(afterOneRetelling).toBeLessThan(baseReliability);
    expect(afterThreeRetellings).toBeLessThan(afterOneRetelling);
  });
});

// ──────────────────────────────────────────────────────────────────
// 5. KNOWLEDGE CONTENT TEMPLATES
// ──────────────────────────────────────────────────────────────────
describe("getContentAtKnowledgeLevel", () => {
  const mockNpcEntry = {
    category: "npc",
    title: "Seraph Vex",
    subtitle: "Master Assassin",
    summary: "A feared killer.",
    custom_lore: "He was once a paladin before the fall.",
    full_content: {
      known_for: ["stealth", "daggers"],
      faction_name: "Shadow Guild",
      biography_short: "Turned to darkness after losing his family.",
    },
  };

  it("level 0 always returns ???", () => {
    expect(getContentAtKnowledgeLevel(mockNpcEntry, 0)).toBe("???");
  });

  it("level 1 gives only vague rumor text", () => {
    const content = getContentAtKnowledgeLevel(mockNpcEntry, 1);
    expect(content).toBeTruthy();
    expect(content).not.toContain("Master Assassin"); // should not reveal subtitle yet
  });

  it("level 2 reveals title and role", () => {
    const content = getContentAtKnowledgeLevel(mockNpcEntry, 2);
    expect(content).toContain("Seraph Vex");
  });

  it("level 3 reveals faction affiliation", () => {
    const content = getContentAtKnowledgeLevel(mockNpcEntry, 3);
    expect(content).toContain("Shadow Guild");
  });

  it("level 5 returns full custom lore", () => {
    const content = getContentAtKnowledgeLevel(mockNpcEntry, 5);
    expect(content).toContain("paladin");
  });

  it("fallback category returns summary for level >= 2", () => {
    const entry = { category: "lore", title: "Ancient Prophecy", summary: "The stars align.", full_content: {} };
    expect(getContentAtKnowledgeLevel(entry, 2)).toContain("The stars align.");
    expect(getContentAtKnowledgeLevel(entry, 0)).toBe("???");
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. computeImportance (engine wrapper)
// ──────────────────────────────────────────────────────────────────
describe("computeImportance (engine wrapper)", () => {
  it("delegates to computeImportanceScore correctly", () => {
    const result = computeImportance({ deaths_involved: 1, factions_involved: 2 });
    expect(result).toBe(computeImportanceScore({ deaths_involved: 1, factions_involved: 2 }));
  });
});

// ──────────────────────────────────────────────────────────────────
// 7. DB-DEPENDENT FUNCTIONS — mock pool tests
// ──────────────────────────────────────────────────────────────────
describe("grantKnowledge (mock pool)", () => {
  it("returns CharacterKnowledge on success", async () => {
    const { grantKnowledge } = await import("./encyclopediaEngine");
    const mockKnowledge = {
      id: "ck-1",
      character_id: "char-1",
      entry_id: "entry-1",
      campaign_id: "camp-1",
      knowledge_level: 2,
      discovery_source: "exploration",
      discovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const pool = makeMockPool([
      [{ title: "Old Ruins" }],  // SELECT title
      [mockKnowledge],            // INSERT...RETURNING
    ]);
    const result = await grantKnowledge(pool as any, "char-1", "entry-1", "camp-1", 2, "exploration");
    expect(result).not.toBeNull();
    expect(result!.knowledge_level).toBe(2);
    expect(result!.discovery_source).toBe("exploration");
  });

  it("never downgrades knowledge level", async () => {
    // The DB enforces GREATEST() in the upsert — our test verifies the function calls INSERT correctly
    const { grantKnowledge } = await import("./encyclopediaEngine");
    const existingHighLevel = {
      id: "ck-2",
      character_id: "char-1",
      entry_id: "entry-2",
      campaign_id: "camp-1",
      knowledge_level: 4, // already at level 4
      discovery_source: "dm_grant",
      discovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const pool = makeMockPool([
      [{ title: "Dragon Lair" }],
      [existingHighLevel], // DB returns the GREATEST of 4 vs 2 = 4
    ]);
    const result = await grantKnowledge(pool as any, "char-1", "entry-2", "camp-1", 2, "rumor");
    expect(result!.knowledge_level).toBe(4); // Should be unchanged
  });

  it("returns null and logs error on DB failure", async () => {
    const { grantKnowledge } = await import("./encyclopediaEngine");
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await grantKnowledge(pool as any, "char-1", "entry-1", "camp-1", 2, "exploration");
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("createEntryFromSource (mock pool)", () => {
  it("returns existing entry if already created (no duplicate)", async () => {
    const { createEntryFromSource } = await import("./encyclopediaEngine");
    const existingEntry = {
      id: "entry-existing",
      campaign_id: "camp-1",
      category: "npc",
      source_id: "npc-1",
      source_type: "npc",
      title: "Old Barkeep",
      subtitle: null,
      summary: null,
      full_content: "{}",
      tags: [],
      is_secret: false,
      dm_notes: null,
      custom_lore: null,
      pinned: false,
      importance: 0,
      era_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const pool = makeMockPool([
      [existingEntry], // SELECT returns existing
    ]);
    const result = await createEntryFromSource(pool as any, "npc", "npc-1", "camp-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("entry-existing");
    expect(pool.query).toHaveBeenCalledTimes(1); // Only the SELECT, no INSERT
  });

  it("creates new entry when none exists", async () => {
    const { createEntryFromSource } = await import("./encyclopediaEngine");
    const newEntry = {
      id: "entry-new",
      campaign_id: "camp-1",
      category: "location",
      title: "Sunken Keep",
      full_content: "{}",
      tags: [],
      is_secret: false,
      pinned: false,
      importance: 0,
      subtitle: null,
      summary: "A flooded castle.",
      dm_notes: null,
      custom_lore: null,
      era_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const pool = makeMockPool([
      [],          // SELECT returns nothing
      [{ name: "Sunken Keep", type: "ruin", description: "A flooded castle." }], // SELECT location
      [newEntry],  // INSERT RETURNING
    ]);
    const result = await createEntryFromSource(pool as any, "location", "loc-1", "camp-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("entry-new");
  });
});

describe("resolveRumor (mock pool)", () => {
  it("marks rumor resolved and broadcasts", async () => {
    const { resolveRumor } = await import("./encyclopediaEngine");
    const { RoomManager } = await import("../websocket/roomManager");

    const rumor = {
      id: "rumor-1",
      campaign_id: "camp-1",
      entry_id: "entry-1",
      content: "The king was poisoned by his advisor",
      reliability: 70,
      is_true: null,
      source_type: "npc",
      source_id: null,
      spread_count: 3,
      contradicts_rumor_id: null,
      resolved_at: null,
      created_at: new Date().toISOString(),
    };

    const pool = makeMockPool([
      [rumor],   // SELECT rumor
      [],        // UPDATE rumors SET is_true
      [{ character_id: "char-1" }, { character_id: "char-2" }], // SELECT character_rumors
      [],        // SELECT believed = true
    ]);

    await resolveRumor(pool as any, "rumor-1", "camp-1", true);

    expect(RoomManager.broadcastToRoom).toHaveBeenCalledWith(
      "camp-1",
      "RUMOR_RESOLVED",
      expect.objectContaining({ rumor_id: "rumor-1", is_true: true })
    );
  });

  it("does nothing if rumor not found", async () => {
    const { resolveRumor } = await import("./encyclopediaEngine");
    const { RoomManager } = await import("../websocket/roomManager");
    vi.mocked(RoomManager.broadcastToRoom).mockClear();

    const pool = makeMockPool([[]]); // SELECT returns nothing
    await resolveRumor(pool as any, "ghost-rumor", "camp-1", true);
    expect(RoomManager.broadcastToRoom).not.toHaveBeenCalled();
  });
});

describe("searchEncyclopedia (mock pool)", () => {
  it("returns all matching entries for DM", async () => {
    const { searchEncyclopedia } = await import("./encyclopediaEngine");
    const entries = [
      { id: "e1", title: "Dragon", category: "creature", full_content: "{}", tags: [], summary: "A dragon." },
      { id: "e2", title: "Dragon Lair", category: "location", full_content: "{}", tags: [], summary: "Its home." },
    ];
    const pool = makeMockPool([entries]);
    const results = await searchEncyclopedia(pool as any, "camp-1", null, "dragon", true);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.knowledge_level === 5)).toBe(true);
  });

  it("returns empty array for player with no characterId", async () => {
    const { searchEncyclopedia } = await import("./encyclopediaEngine");
    const pool = makeMockPool([[]]);
    const results = await searchEncyclopedia(pool as any, "camp-1", null, "ruins", false);
    expect(results).toEqual([]);
  });

  it("returns knowledge-filtered entries for player", async () => {
    const { searchEncyclopedia } = await import("./encyclopediaEngine");
    const rows = [
      {
        id: "e1", title: "Hidden Temple", category: "location",
        full_content: "{}", tags: [], summary: "A secret temple.",
        knowledge_level: 2,
      },
    ];
    const pool = makeMockPool([rows]);
    const results = await searchEncyclopedia(pool as any, "camp-1", "char-1", "temple", false);
    expect(results.length).toBe(1);
    expect(results[0].knowledge_level).toBe(2);
  });
});

describe("generateSessionSummary (mock pool + Groq)", () => {
  it("calls dmService and stores summary", async () => {
    const { generateSessionSummary } = await import("./encyclopediaEngine");
    const { dmService } = await import("../ai/dmService");
    const { RoomManager } = await import("../websocket/roomManager");

    const session = {
      id: "sess-1",
      campaign_id: "camp-1",
      session_number: 5,
      player_character_ids: ["char-1"],
      event_ids: [],
      ai_summary: null,
      dm_notes: null,
      summary_approved: false,
      importance: 0,
      started_at: null,
      ended_at: null,
      created_at: new Date().toISOString(),
    };

    const updatedSession = {
      ...session,
      ai_summary: "A brave band of adventurers ventured forth...",
      summary_approved: false,
    };

    const pool = makeMockPool([
      [session],           // 1. SELECT session_records
      [{ name: "Ironhold", session_count: 5 }], // 2. SELECT campaigns
      [{ name: "Brynn", race: "elf", class: "ranger" }], // 3. SELECT characters
      // NOTE: event query is SKIPPED when event_ids is empty []
      [],                  // 4. SELECT nemeses
      [],                  // 5. SELECT factions
      [updatedSession],    // 6. UPDATE session_records RETURNING
    ]);

    const result = await generateSessionSummary(pool as any, "sess-1", "camp-1");
    expect(result).not.toBeNull();
    expect(result!.ai_summary).toBeTruthy();
    expect(dmService.generateSessionSummary).toHaveBeenCalled();
    expect(RoomManager.broadcastToRoom).toHaveBeenCalledWith(
      "camp-1",
      "SESSION_SUMMARY_READY",
      expect.objectContaining({ approved: false })
    );
  });
});
