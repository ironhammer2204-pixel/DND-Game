import assert from "assert";
import {
  generateNemesisName,
  generateNemesisEpithet,
  selectNemesisTarget,
  coordinateNemesisMinions,
  promoteEnemyToNemesis,
  levelNemesisAfterEncounter,
  applyNemesisScar,
  assignSuccessor,
  evaluateCombatForNemesisPromotion,
  handleNemesisQuestIntegration,
} from "../nemesisEngine";
import { runWorldHeartbeat } from "../worldEngine";
import { CombatParticipant, CombatEncounter, Nemesis, Faction, Quest } from "@dnd/shared";

// A mock Pool/PoolClient implementation for testing
class MockPool {
  queries: { sql: string; params?: any[] }[] = [];
  responses: any[] = [];

  constructor() {}

  async query(sql: string, params?: any[]) {
    this.queries.push({ sql, params });
    const nextResponse = this.responses.shift();
    if (nextResponse) {
      if (nextResponse instanceof Error) {
        throw nextResponse;
      }
      return nextResponse;
    }
    return { rows: [] };
  }

  // Support transactions
  async connect() {
    return this;
  }
  release() {}
}

const mockCampaignId = "550e8400-e29b-41d4-a716-446655440000";
const mockLocationId = "660e8400-e29b-41d4-a716-446655441111";
const mockCharacterId = "770e8400-e29b-41d4-a716-446655442222";

async function runTests() {
  console.log("=== Running Nemesis System Tests ===");

  // 1. generateNemesisName
  console.log("Test 1: generateNemesisName...");
  const name1 = generateNemesisName("orc", "brutal");
  assert.ok(name1.includes("Ghar"));
  assert.ok(name1.includes("Orc") || name1.includes("Unknown")); // MONSTERS is mockable or uses fallback

  // 2. generateNemesisEpithet
  console.log("Test 2: generateNemesisEpithet...");
  const epithet1 = generateNemesisEpithet("soldier", "seed-123");
  assert.strictEqual(typeof epithet1, "string");
  assert.ok(epithet1.length > 0);

  // 3. selectNemesisTarget
  console.log("Test 3: selectNemesisTarget...");
  const players: CombatParticipant[] = [
    {
      id: "p1",
      name: "Fighter",
      type: "player",
      hp_current: 25,
      hp_max: 30,
      initiative: 12,
      conditions: [],
      ac: 16,
      attack_bonus: 5,
      damage_dice: "1d8",
      damage_modifier: 3,
    },
    {
      id: "p2",
      name: "Wizard",
      type: "player",
      hp_current: 12,
      hp_max: 18,
      initiative: 15,
      conditions: [],
      ac: 12,
      attack_bonus: 4,
      damage_dice: "1d6",
      damage_modifier: 2,
    },
  ];

  // Brutal targets lowest HP
  const targetBrutal = selectNemesisTarget({ personality: "brutal", target_character_id: null }, players);
  assert.strictEqual(targetBrutal?.id, "p2"); // Wizard has lower hp (12 < 25)

  // Honorable targets strongest (attack_bonus + hp_max)
  const targetHonorable = selectNemesisTarget({ personality: "honorable", target_character_id: null }, players);
  assert.strictEqual(targetHonorable?.id, "p1"); // Fighter: 5+30 = 35; Wizard: 4+18 = 22

  // Vengeful targets grudge target if present
  const targetVengeful = selectNemesisTarget({ personality: "vengeful", target_character_id: "p1" }, players);
  assert.strictEqual(targetVengeful?.id, "p1");

  // 4. coordinateNemesisMinions
  console.log("Test 4: coordinateNemesisMinions...");
  const minionsCoord = coordinateNemesisMinions(
    { personality: "warlord", tier: "warlord", minion_ids: ["m1"] },
    players
  );
  assert.strictEqual(minionsCoord.command, "focus_fire");
  assert.strictEqual(minionsCoord.priority_target?.id, "p2"); // Lowest hp

  // 5. promoteEnemyToNemesis
  console.log("Test 5: promoteEnemyToNemesis...");
  const mockPool = new MockPool();
  const enemyParticipant: CombatParticipant = {
    id: "enemy-1",
    name: "Goblin Scout",
    type: "enemy",
    hp_current: 8,
    hp_max: 8,
    initiative: 14,
    conditions: [],
    ac: 13,
    attack_bonus: 3,
    damage_dice: "1d6",
    damage_modifier: 1,
    xp_value: 50,
  };

  // Setup DB queries response:
  // Query 1: insert nemesis
  mockPool.responses.push({
    rows: [
      {
        id: "nemesis-uuid-1",
        campaign_id: mockCampaignId,
        source_monster_id: "goblin",
        name: "Rav Goblin",
        epithet: "the Sly",
        tier: "soldier",
        status: "active",
        level: 1,
        xp: 50,
        personality: "cunning",
        traits: {},
        tactics: {},
        stats: { hp_max: 15, ac: 13, attack_bonus: 3, damage_dice: "1d6", damage_modifier: 1, xp_value: 50 },
        scars: [],
        appearance: {},
        faction_id: null,
        minion_ids: [],
        location_id: mockLocationId,
        target_character_id: mockCharacterId,
        grudge_score: 20,
        bounty_on_party: 100,
        successor_nemesis_id: null,
      },
    ],
  });
  // Query 2: insert history
  mockPool.responses.push({
    rows: [
      {
        id: "history-uuid-1",
        nemesis_id: "nemesis-uuid-1",
        campaign_id: mockCampaignId,
        event_type: "nemesis_promoted",
        summary: "Rav Goblin became a nemesis.",
        mechanical_data: {},
        occurred_at: new Date().toISOString(),
      },
    ],
  });
  // Query 3: insert event log
  mockPool.responses.push({ rows: [{ id: "event-uuid-1" }] });
  // Query 4: select quests for quest integration checking
  mockPool.responses.push({ rows: [] }); // No active quest
  // Query 5: insert quest
  mockPool.responses.push({ rows: [{ id: "quest-uuid-1", title: "Defeat Rav Goblin", objectives: [] }] });

  const promotionResult = await promoteEnemyToNemesis(mockPool as any, mockCampaignId, enemyParticipant, {
    reason: "survived_combat",
    targetCharacterId: mockCharacterId,
    tier: "soldier",
    grudgeScore: 20,
  });

  assert.strictEqual(promotionResult.nemesis.name, "Rav Goblin");
  assert.strictEqual(promotionResult.history.event_type, "nemesis_promoted");
  assert.strictEqual(mockPool.queries.length, 5);

  // 6. levelNemesisAfterEncounter
  console.log("Test 6: levelNemesisAfterEncounter...");
  mockPool.queries = [];
  mockPool.responses = [];

  // Query 1: getNemesisById
  mockPool.responses.push({ rows: [promotionResult.nemesis] });
  // Query 2: count history encounters
  mockPool.responses.push({ rows: [{ count: 1 }] });
  // Query 3: update nemesis
  mockPool.responses.push({ rows: [{ ...promotionResult.nemesis, level: 2, xp: 100 }] });
  // Query 4: record history
  mockPool.responses.push({ rows: [{ id: "history-uuid-2", event_type: "nemesis_leveled" }] });

  const leveled = await levelNemesisAfterEncounter(mockPool as any, mockCampaignId, "nemesis-uuid-1", 50);
  assert.ok(leveled);
  assert.strictEqual(leveled.level, 2);

  // 7. applyNemesisScar
  console.log("Test 7: applyNemesisScar...");
  mockPool.queries = [];
  mockPool.responses = [];

  // Query 1: getNemesisById
  mockPool.responses.push({ rows: [leveled] });
  // Query 2: update nemesis with scar
  mockPool.responses.push({
    rows: [
      {
        ...leveled,
        scars: [{ type: "blinded_eye", label: "Blinded Eye", effect: "-1 attack", applied_at: new Date().toISOString() }],
        grudge_score: leveled.grudge_score + 15,
      },
    ],
  });
  // Query 3: record history
  mockPool.responses.push({ rows: [{ id: "history-uuid-3", event_type: "nemesis_scarred" }] });

  const scarred = await applyNemesisScar(mockPool as any, mockCampaignId, "nemesis-uuid-1", "test-seed");
  assert.ok(scarred);
  assert.strictEqual(scarred.scars.length, 1);
  assert.strictEqual(scarred.scars[0].type, "blinded_eye");
  assert.strictEqual(scarred.grudge_score, leveled.grudge_score + 15);

  // 8. assignSuccessor
  console.log("Test 8: assignSuccessor...");
  mockPool.queries = [];
  mockPool.responses = [];

  const deadNemesis = { ...promotionResult.nemesis, status: "dead" as const, grudge_score: 30, bounty_on_party: 150 };
  const successorNemesis = {
    id: "nemesis-uuid-2",
    campaign_id: mockCampaignId,
    name: "Rav successor",
    tier: "lieutenant" as const,
    status: "active" as const,
    grudge_score: 10,
    bounty_on_party: 50,
    faction_id: null,
    scars: [],
  };

  // Query 1: getNemesisById (deadNemesis)
  mockPool.responses.push({ rows: [deadNemesis] });
  // Query 2: select candidates (returns successorCandidate)
  mockPool.responses.push({ rows: [{ id: "nemesis-uuid-2" }] });
  // Query 3: update successor grudge and bounty
  mockPool.responses.push({ rows: [] });
  // Query 4: update dead nemesis successor link
  mockPool.responses.push({ rows: [] });
  // Query 5: getNemesisById (updated successor)
  mockPool.responses.push({ rows: [{ ...successorNemesis, grudge_score: 40, bounty_on_party: 200 }] });
  // Query 6: record history on successor
  mockPool.responses.push({ rows: [{ id: "history-uuid-4" }] });
  // Query 7: select active quests for quest integration checking
  mockPool.responses.push({ rows: [] }); // None

  const successorResult = await assignSuccessor(mockPool as any, mockCampaignId, "nemesis-uuid-1");
  assert.ok(successorResult);
  assert.strictEqual(successorResult.id, "nemesis-uuid-2");
  assert.strictEqual(successorResult.grudge_score, 40); // 10 base + 30 inherited
  assert.strictEqual(successorResult.bounty_on_party, 200); // 50 base + 150 inherited

  // 9. evaluateCombatForNemesisPromotion (Killed nemesis path)
  console.log("Test 9: evaluateCombatForNemesisPromotion...");
  mockPool.queries = [];
  mockPool.responses = [];

  const combatEncounter: CombatEncounter = {
    id: "encounter-1",
    campaign_id: mockCampaignId,
    status: "active",
    turn_order: [],
    current_turn_index: 0,
    participants: [
      {
        id: "enemy-instance-1",
        name: "Rav Goblin",
        type: "enemy",
        nemesis_id: "nemesis-uuid-1",
        hp_current: 0, // Slain!
        hp_max: 15,
        initiative: 10,
        conditions: [],
        ac: 13,
        attack_bonus: 3,
        damage_dice: "1d6",
        damage_modifier: 1,
      },
    ],
    round_number: 1,
    started_at: new Date().toISOString(),
  };

  // Query 1: update nemesis status to dead
  mockPool.responses.push({ rows: [deadNemesis] });
  // Query 2: record history for killed
  mockPool.responses.push({ rows: [{ id: "history-uuid-5", event_type: "nemesis_killed" }] });
  // Query 3: select active quests for quest integration (killed)
  mockPool.responses.push({ rows: [] });
  // Query 4: getNemesisById (assignSuccessor: deadNemesis)
  mockPool.responses.push({ rows: [deadNemesis] });
  // Query 5: select candidates (assignSuccessor: none)
  mockPool.responses.push({ rows: [] });

  await evaluateCombatForNemesisPromotion(mockPool as any, combatEncounter, "victory");
  assert.ok(mockPool.queries[0].sql.includes("UPDATE public.nemeses SET status = 'dead'"));

  // 10. handleNemesisQuestIntegration
  console.log("Test 10: handleNemesisQuestIntegration...");
  mockPool.queries = [];
  mockPool.responses = [];

  // Testing the "killed" trigger completing quest objectives
  const mockQuest: Quest = {
    id: "quest-uuid-2",
    campaign_id: mockCampaignId,
    type: "side",
    title: "Defeat Rav Goblin",
    status: "active",
    objectives: [
      { text: "Defeat Rav Goblin", completed: false, nemesis_id: "nemesis-uuid-1" },
    ],
    rewards: { gold: 100 },
    created_at: new Date().toISOString(),
  };

  // Query 1: select active quests
  mockPool.responses.push({ rows: [mockQuest] });
  // Query 2: update quest to complete
  mockPool.responses.push({ rows: [{ ...mockQuest, status: "complete", objectives: [{ text: "Defeat Rav Goblin", completed: true, nemesis_id: "nemesis-uuid-1" }] }] });
  // Query 3: insert quest completion event log
  mockPool.responses.push({ rows: [{ id: "event-log-uuid" }] });

  await handleNemesisQuestIntegration(mockPool as any, mockCampaignId, deadNemesis as any, "killed");
  assert.ok(mockPool.queries[1].sql.includes("UPDATE public.quests"));
  assert.ok(mockPool.queries[1].params?.[1] === "complete");

  // 11. runWorldHeartbeat
  console.log("Test 11: runWorldHeartbeat...");
  mockPool.queries = [];
  mockPool.responses = [];

  const mockLocation = {
    id: mockLocationId,
    name: "Briarwood Wilds",
    connected_locations: [mockLocationId],
  };

  // Query 1: select campaign world state
  mockPool.responses.push({
    rows: [
      {
        world_state: {
          character_locations: {
            "char-1": mockLocationId,
          },
        },
      },
    ],
  });
  // Query 2: select active nemeses
  mockPool.responses.push({
    rows: [
      {
        ...promotionResult.nemesis,
        grudge_score: 90,
        location_id: mockLocationId,
      },
    ],
  });
  // Rest Trigger:
  // Query 3: update status to ambushing
  mockPool.responses.push({ rows: [{ ...promotionResult.nemesis, status: "ambushing" }] });
  // Query 4: record history for ambush
  mockPool.responses.push({ rows: [{ id: "history-uuid-ambush" }] });
  // Query 5: select location name
  mockPool.responses.push({ rows: [{ name: "Briarwood Wilds" }] });
  // Query 6: insert event log for ambush
  mockPool.responses.push({ rows: [{ id: "log-uuid-1" }] });
  // Movement Tick (non-ambushing, chance based, let's mock it):
  // Query 7: select location info
  mockPool.responses.push({ rows: [mockLocation] });
  // Query 8: update location in DB
  mockPool.responses.push({ rows: [] });
  // Query 9: record history for movement
  mockPool.responses.push({ rows: [] });
  // Query 10: select updated nemeses
  mockPool.responses.push({ rows: [] });

  await runWorldHeartbeat(mockPool as any, mockCampaignId, true); // resting rest trigger!
  assert.ok(mockPool.queries[2].sql.includes("status = 'ambushing'"));

  console.log("=== All Nemesis System Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
