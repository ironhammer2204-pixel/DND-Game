import assert from "assert";
import {
  tickNpcAgendas,
  updateNpcRelationship,
  checkSecretRevealConditions,
} from "../npcAgendaEngine";
import { dmService } from "../../ai/dmService";

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
}

const mockCampaignId = "test-campaign-1";

async function runTests() {
  console.log("=== Running NPC Agenda Engine Tests ===");

  // 1. tickNpcAgendas (Fearful NPC seeking ally)
  console.log("Test 1: tickNpcAgendas (Fearful NPC seeking ally)...");
  const pool1 = new MockPool();
  pool1.responses.push({
    rows: [
      {
        id: "npc-1",
        name: "Fearful Fred",
        location_id: "loc-1",
        agenda_state: {
          current_step: 0,
          ticks_at_current_step: 3, // Needs one more tick to hit threshold (fear 80, amb 20 => threshold 5 => wait, I'll set it to match)
          last_action: null,
          blocked_reason: null,
        },
        base_stats: { fear: 80, ambition: 20 },
        short_term_goal: "Survive",
        long_term_goal: "Run away",
      },
    ],
  });

  // Since fear=80, amb=20 -> diff = 60. threshold = 3 + 60/30 = 5.
  // We'll set the tick to 4, so next is 5, causing action.
  pool1.responses[0].rows[0].agenda_state.ticks_at_current_step = 4;
  
  pool1.responses.push({ rows: [{ id: "event-log-1" }] }); // Insert event log
  pool1.responses.push({ rows: [] }); // Update NPC state

  // Disable dmService to avoid enqueueing and external DB dependencies
  const originalDmEnabled = dmService.isEnabled;
  dmService.isEnabled = () => false;

  await tickNpcAgendas(pool1 as any, mockCampaignId);

  // Check event log insertion
  const eventLogQuery = pool1.queries.find((q) => q.sql.includes("INSERT INTO public.event_log"));
  assert.ok(eventLogQuery);
  assert.ok(eventLogQuery.params?.[2].includes("seek_ally"));

  // Check state update
  const updateQuery = pool1.queries.find((q) => q.sql.includes("UPDATE public.npcs SET agenda_state"));
  assert.ok(updateQuery);
  const updatedState = JSON.parse(updateQuery.params?.[0]);
  assert.strictEqual(updatedState.last_action, "seek_ally");
  assert.strictEqual(updatedState.ticks_at_current_step, 0);

  // 2. updateNpcRelationship
  console.log("Test 2: updateNpcRelationship (caps at 100/-100)...");
  const pool2 = new MockPool();
  pool2.responses.push({
    rows: [{ relationship_map: { "char-1": 90 } }],
  });
  pool2.responses.push({ rows: [] }); // Update query

  await updateNpcRelationship(pool2 as any, "npc-1", "char-1", 20); // 90 + 20 = 110, should cap at 100
  const updateMapQuery = pool2.queries.find((q) => q.sql.includes("UPDATE public.npcs SET relationship_map"));
  assert.ok(updateMapQuery);
  const updatedMap = JSON.parse(updateMapQuery.params?.[0]);
  assert.strictEqual(updatedMap["char-1"], 100);

  // 3. checkSecretRevealConditions
  console.log("Test 3: checkSecretRevealConditions (trust > 80)...");
  const pool3 = new MockPool();
  pool3.responses.push({
    rows: [
      {
        name: "Secretive Sally",
        secret: "I am a spy",
        secret_revealed: false,
        relationship_map: { "char-1": 90, "char-2": 80 }, // avg = 85
      },
    ],
  });
  pool3.responses.push({ rows: [] }); // Update query
  pool3.responses.push({ rows: [{ id: "event-log-2" }] }); // Insert event log

  const revealed = await checkSecretRevealConditions(pool3 as any, "npc-2", mockCampaignId);
  assert.strictEqual(revealed, true);
  const revealUpdateQuery = pool3.queries.find((q) => q.sql.includes("UPDATE public.npcs SET secret_revealed"));
  assert.ok(revealUpdateQuery);
  const revealLogQuery = pool3.queries.find((q) => q.sql.includes("INSERT INTO public.event_log"));
  assert.ok(revealLogQuery);

  dmService.isEnabled = originalDmEnabled; // Restore
  console.log("=== All NPC Agenda Engine Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
