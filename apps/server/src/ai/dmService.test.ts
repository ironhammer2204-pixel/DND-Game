import { vi } from "vitest";

// Mock pg-boss first. Define and export mock functions from within the mock factory.
vi.mock("pg-boss", () => {
  const mockSend = vi.fn().mockResolvedValue("job-id-123");
  const mockWork = vi.fn().mockResolvedValue("worker-id-123");
  const mockStart = vi.fn().mockResolvedValue(null);
  const mockStop = vi.fn().mockResolvedValue(null);
  const mockOn = vi.fn();

  class MockPgBoss {
    on = mockOn;
    start = mockStart;
    stop = mockStop;
    work = mockWork;
    send = mockSend;
    constructor(config?: any) {}
  }

  return {
    PgBoss: MockPgBoss,
    _mockSend: mockSend,
    _mockWork: mockWork,
    _mockStart: mockStart,
    _mockStop: mockStop,
    _mockOn: mockOn,
  };
});

// Mock pg pool
vi.mock("../db/client", () => {
  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [{ count: "0" }] }),
    },
  };
});

// Mock openai
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [
                {
                  message: {
                    content: "This is a narrated event of your brave action.",
                  },
                },
              ],
            }),
          },
        },
      };
    }),
  };
});

import { describe, it, expect, beforeEach } from "vitest";
import { dmService, filterNarration, validateAndRepairNarration } from "./dmService";
// @ts-ignore
import { _mockSend } from "pg-boss";

describe("AI Narration Pipeline & Filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("filterNarration", () => {
    it("should strip XP numbers from AI outputs", () => {
      const input = "You gain 300 XP for defeating the goblin.";
      const filtered = filterNarration(input);
      expect(filtered).not.toContain("300 XP");
    });

    it("should strip HP damage/healing values", () => {
      const input = "The warrior takes 15 HP damage and then heals 5 health.";
      const filtered = filterNarration(input);
      expect(filtered).not.toContain("15 HP");
      expect(filtered).not.toContain("5 health");
    });

    it("should strip roll results", () => {
      const input = "You rolled a 20, resulting in a total of 25.";
      const filtered = filterNarration(input);
      expect(filtered).not.toContain("rolled a 20");
      expect(filtered).not.toContain("total of 25");
    });

    it("should strip quest completion statements", () => {
      const input = "The quest is complete and the reward is yours.";
      const filtered = filterNarration(input);
      expect(filtered).not.toContain("quest is complete");
    });

    it("should strip player death declarations but keep general descriptive death", () => {
      const input1 = "You are dead and your soul departs.";
      const input2 = "The goblin chieftain lies dead on the stone floor.";
      
      expect(filterNarration(input1)).not.toContain("You are dead");
      expect(filterNarration(input2)).toContain("chieftain lies dead");
    });
  });

  describe("validateAndRepairNarration", () => {
    it("should return fallback narration if output is empty/filtered out", () => {
      const input = "You rolled a 20, takes 5 damage, quest is complete.";
      const result = validateAndRepairNarration(input, "combat_victory");
      expect(result).toBe("The enemies fall. Against all odds, victory is yours.");
    });

    it("should return fallback if result length is too short", () => {
      const input = "A sword swings.";
      const result = validateAndRepairNarration(input, "action");
      expect(result).toBe("An action is taken, reshaping the course of the adventure.");
    });

    it("should clean up double spaces and orphaned punctuation", () => {
      const input = "The warrior  strikes the dragon  . The beast roars .";
      const result = validateAndRepairNarration(input, "combat_round");
      expect(result).toBe("The warrior strikes the dragon. The beast roars.");
    });
  });

  describe("dmService Queue Integration", () => {
    it("isEnabled() returns status correctly based on GROQ_API_KEY", () => {
      const originalKey = process.env.GROQ_API_KEY;
      
      process.env.GROQ_API_KEY = "test-key";
      expect(dmService.isEnabled()).toBe(true);

      process.env.GROQ_API_KEY = "";
      expect(dmService.isEnabled()).toBe(false);

      process.env.GROQ_API_KEY = originalKey;
    });

    it("enqueueing a job delegates to pg-boss send method", () => {
      process.env.GROQ_API_KEY = "test-key";
      
      dmService.enqueueCombatStart({}, "log-1", "campaign-1", {
        party: [],
        enemies: [],
        location: { name: "Forest" },
      });

      expect(_mockSend).toHaveBeenCalledWith("narration", expect.objectContaining({
        eventLogId: "log-1",
        campaignId: "campaign-1",
        promptType: "combat_start",
      }));
    });
  });
});
