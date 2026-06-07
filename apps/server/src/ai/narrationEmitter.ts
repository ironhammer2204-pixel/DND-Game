import { EventEmitter } from "events";

/** Emits 'narration' events when AI DM text is ready for a campaign. */
export const narrationEmitter = new EventEmitter();
// Prevent MaxListenersExceededWarning in test envs or when multiple routes attach listeners
narrationEmitter.setMaxListeners(50);

export interface NarrationReadyPayload {
  campaignId: string;
  eventLogId: string;
  narration: string;
}
