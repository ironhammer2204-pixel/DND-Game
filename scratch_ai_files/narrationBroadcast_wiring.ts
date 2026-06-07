/**
 * NARRATION BROADCAST — apps/server/src/websocket/eventHandlers.ts
 *
 * The AI DM narration arrives asynchronously — up to a few seconds after the
 * game event that triggered it. Clients need to receive it separately.
 *
 * Strategy: poll event_log on a short delay, OR use a db-triggered approach.
 * We use the simpler approach: the narration job itself calls broadcastNarration
 * after saveNarration completes, using the roomManager.
 *
 * Implementation: pass a broadcast callback into dmService jobs.
 * The cleanest way to do this without tight coupling is a small event emitter.
 */

// ============================================================
// apps/server/src/ai/narrationEmitter.ts  (new tiny file)
// ============================================================

import { EventEmitter } from "events";

/** Emits 'narration' events when AI DM text is ready for a campaign. */
export const narrationEmitter = new EventEmitter();

export interface NarrationReadyPayload {
  campaignId: string;
  eventLogId: string;
  narration: string;
}

// ============================================================
// Update dmService.ts — saveNarration() to emit after DB write
// ============================================================

// FIND in dmService.ts:
//   async function saveNarration(pool, eventLogId, narration)

// REPLACE with:
import { narrationEmitter, type NarrationReadyPayload } from "./narrationEmitter";

async function saveNarration(
  pool: Pool,
  eventLogId: string,
  narration: string,
  campaignId: string   // ← add this param; pass it from each enqueue call
): Promise<void> {
  await pool.query(
    `UPDATE event_log SET ai_narration = $1 WHERE id = $2`,
    [narration, eventLogId]
  );
  // Emit so the WS layer can push it without being coupled to dmService
  narrationEmitter.emit("narration", {
    campaignId,
    eventLogId,
    narration,
  } satisfies NarrationReadyPayload);
}

// ============================================================
// Update eventHandlers.ts — listen for narration and broadcast
// ============================================================

// ADD once during server startup (e.g. in the same file that sets up rooms):

import { narrationEmitter, type NarrationReadyPayload } from "../ai/narrationEmitter";
import { roomManager } from "./roomManager";

narrationEmitter.on("narration", (payload: NarrationReadyPayload) => {
  const room = roomManager.getRoom(payload.campaignId);
  if (!room) return; // Campaign has no active players — that's fine
  room.broadcast({
    type: "AI_NARRATION",
    payload: {
      event_log_id: payload.eventLogId,
      narration: payload.narration,
    },
  });
});

// ============================================================
// Frontend — gameStore.ts  (handle AI_NARRATION WS message)
// ============================================================

// In your WS message handler switch:
case "AI_NARRATION": {
  const { event_log_id, narration } = message.payload;
  // Attach narration to the matching event in the events array
  set(state => ({
    events: state.events.map(evt =>
      evt.id === event_log_id
        ? { ...evt, ai_narration: narration }
        : evt
    ),
  }));
  break;
}

// ============================================================
// Frontend — GamePage.tsx  (display narration below events)
// ============================================================

// In your event feed renderer, after the event summary line:
{event.ai_narration && (
  <p className="mt-1 text-sm italic text-amber-200/80 leading-relaxed">
    {event.ai_narration}
  </p>
)}

// That's it. The narration appears a few seconds after the mechanical result,
// which actually feels good — like the DM pausing before describing the scene.
