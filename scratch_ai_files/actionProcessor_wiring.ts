/**
 * ACTION PROCESSOR WIRING — apps/server/src/game/actionProcessor.ts
 *
 * Apply these changes manually.
 * All enqueue calls happen AFTER the DB write and AFTER the broadcast.
 * They are fire-and-forget — never awaited in the hot path.
 */

// ============================================================
// CHANGE 1 — Add imports
// ============================================================

import { dmService } from "../ai/dmService";
import {
  buildCampaignSnapshot,
  getLocationContext,
} from "../ai/contextBuilder";

// ============================================================
// CHANGE 2 — Movement action (when target_location_id is set)
//            After location update is committed and broadcast
// ============================================================

// FIND: after the movement DB write + broadcast block

if (dmService.isEnabled() && movementEventLogId) {
  // Both location objects are already in scope from the movement logic
  const snapshot = await buildCampaignSnapshot(pool, newLocationId);
  dmService.enqueueMovement(pool, movementEventLogId, {
    party: snapshot.party,
    fromLocation: previousLocation,  // LocationContext you fetched earlier
    toLocation: snapshot.location ?? { name: "unknown", description: "" },
    npcs: snapshot.npcs,
    recentEvents: snapshot.recentEvents,
  });
}

// ============================================================
// CHANGE 3 — Skill check action
//            After skill check result is written + broadcast
// ============================================================

if (dmService.isEnabled() && skillCheckEventLogId) {
  const snapshot = await buildCampaignSnapshot(pool, campaignId);
  dmService.enqueueSkillCheck(pool, skillCheckEventLogId, {
    party: snapshot.party,
    location: snapshot.location ?? { name: "unknown", description: "" },
    characterName: actor.name,
    skill: input.skill,
    success: skillCheckPassed,
    context: input.action_description,
  });
}

// ============================================================
// CHANGE 4 — Generic / other actions (the catch-all branch)
//            After DB write + broadcast
// ============================================================

if (dmService.isEnabled() && actionEventLogId) {
  const snapshot = await buildCampaignSnapshot(pool, campaignId);
  dmService.enqueueAction(pool, actionEventLogId, {
    party: snapshot.party,
    location: snapshot.location ?? { name: "unknown", description: "" },
    npcs: snapshot.npcs,
    quests: snapshot.quests,
    recentEvents: snapshot.recentEvents,
    actorName: actor.name,
    actionDescription: input.action_description ?? "took an action",
    serverResult: actionResultSummary,  // human-readable string you build
  });
}

// ============================================================
// CHANGE 5 — Nemesis ambush trigger (in nemesisEngine.ts triggerAmbush)
//            After ambush event_log INSERT + broadcast
// ============================================================

if (dmService.isEnabled() && ambushEventLogId) {
  const snapshot = await buildCampaignSnapshot(pool, campaignId);
  if (snapshot.nemesis && snapshot.location) {
    dmService.enqueueNemesisAmbush(pool, ambushEventLogId, {
      party: snapshot.party,
      location: snapshot.location,
      nemesis: snapshot.nemesis,
    });
  }
}

// ============================================================
// CHANGE 6 — Nemesis defeated (in combatEngine resolveCombatWithVictory,
//            only when encounter.nemesis_id is set and nemesis status
//            was just updated to 'defeated' or 'fled')
// ============================================================

if (dmService.isEnabled() && nemesisDefeatedEventLogId && nemesisCtx) {
  const snapshot = await buildCampaignSnapshot(pool, campaignId);
  dmService.enqueueNemesisDefeated(pool, nemesisDefeatedEventLogId, {
    party: snapshot.party,
    location: snapshot.location ?? { name: "unknown", description: "" },
    nemesis: nemesisCtx,
    outcome: nemesisOutcome,        // "slain" | "fled" | "captured"
    successorHinted: hasSuccessor,  // boolean from nemesisEngine
  });
}
