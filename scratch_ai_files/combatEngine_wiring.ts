/**
 * COMBAT ENGINE WIRING — apps/server/src/game/combatEngine.ts
 *
 * Apply these changes manually (or use them as a reference diff).
 * Search for each FIND block and replace with the REPLACE block below it.
 * All changes are additive — no existing logic is modified.
 */

// ============================================================
// CHANGE 1 — Add imports at top of combatEngine.ts
// ============================================================

// FIND (after existing imports):
//   import { pool } from "../db";   ← or however your pool is imported

// ADD directly below:
import { dmService } from "../ai/dmService";
import {
  buildCampaignSnapshot,
  getPartyContext,
  getLocationContext,
  getCampaignLocationId,
  getActiveNemesisContext,
} from "../ai/contextBuilder";

// ============================================================
// CHANGE 2 — START_COMBAT handler in eventHandlers.ts
//            (after server writes the combat_encounter row and
//             broadcasts COMBAT_STARTED to all clients)
// ============================================================

// FIND (after the broadcast call for START_COMBAT):
//   room.broadcast({ type: "COMBAT_STARTED", payload: encounter });

// ADD immediately after:
if (dmService.isEnabled()) {
  // Build context from what we already have in memory — no extra DB round-trip
  const locationId = await getCampaignLocationId(pool, campaignId);
  const location = locationId
    ? await getLocationContext(pool, locationId)
    : null;
  const nemesis = await getActiveNemesisContext(pool, campaignId);

  if (location) {
    dmService.enqueueCombatStart(pool, encounter.event_log_id, {
      party: encounter.participants
        .filter(p => p.type === "player")
        .map(p => ({
          name: p.name,
          race: p.race ?? "unknown",
          class_name: p.class_name ?? "adventurer",
          hp_current: p.hp_current,
          hp_max: p.hp_max,
        })),
      location,
      npcs: [],            // no NPCs mid-combat
      nemesis,
      enemyNames: encounter.participants
        .filter(p => p.type === "enemy")
        .map(p => p.name),
      initiativeOrder: encounter.initiative_order.map(
        id => encounter.participants.find(p => p.id === id)?.name ?? id
      ),
    });
  }
}

// ============================================================
// CHANGE 3 — After each round resolves (advanceTurn, end of round)
//            Insert after you've written round results to event_log
// ============================================================

// FIND (after round-end event_log INSERT):
//   // broadcast round results

// ADD before the broadcast:
if (dmService.isEnabled() && roundEventLogId) {
  const nemesis = await getActiveNemesisContext(pool, campaignId);
  dmService.enqueueCombatRound(pool, roundEventLogId, {
    party: encounter.participants
      .filter(p => p.type === "player")
      .map(p => ({
        name: p.name,
        race: p.race ?? "unknown",
        class_name: p.class_name ?? "adventurer",
        hp_current: p.hp_current,
        hp_max: p.hp_max,
      })),
    location: currentLocation!, // you already have this in scope
    nemesis,
    roundNumber: encounter.round_number,
    roundOutcomes: roundOutcomeStrings, // string[] you build while processing actions
  });
}

// ============================================================
// CHANGE 4 — resolveCombatWithVictory  (after XP distributed, DB written)
// ============================================================

// ADD after the victory event_log INSERT:
if (dmService.isEnabled() && victoryEventLogId) {
  const snapshot = await buildCampaignSnapshot(pool, campaignId);
  const nemesis = await getActiveNemesisContext(pool, campaignId);
  const anyUnconscious = encounter.participants.some(
    p => p.type === "player" && p.hp_current <= 0 && p.conditions.includes("stable")
  );
  dmService.enqueueCombatVictory(pool, victoryEventLogId, {
    party: snapshot.party,
    location: snapshot.location ?? { name: "unknown", description: "" },
    quests: snapshot.quests,
    nemesis,
    anyPlayerUnconscious: anyUnconscious,
    nemesisFled: encounter.nemesis_fled ?? false,
  });
}

// ============================================================
// CHANGE 5 — resolveCombatWithDefeat  (after defeat DB write)
// ============================================================

// ADD after the defeat event_log INSERT:
if (dmService.isEnabled() && defeatEventLogId) {
  const snapshot = await buildCampaignSnapshot(pool, campaignId);
  const nemesis = await getActiveNemesisContext(pool, campaignId);
  dmService.enqueueCombatDefeat(pool, defeatEventLogId, {
    party: snapshot.party,
    location: snapshot.location ?? { name: "unknown", description: "" },
    nemesis,
  });
}

// ============================================================
// CHANGE 6 — Death save resolution (inside DEATH_SAVE_ROLL handler)
//            After the save result is written to DB
// ============================================================

// ADD after death save event_log INSERT:
if (dmService.isEnabled() && deathSaveEventLogId) {
  const party = await getPartyContext(pool, campaignId);
  dmService.enqueueDeathSave(pool, deathSaveEventLogId, {
    party,
    characterName: participant.name,
    result: deathSaveResult,   // "success" | "failure" | "stabilised" | "death"
    successes: participant.death_save_successes,
    failures: participant.death_save_failures,
  });
}
