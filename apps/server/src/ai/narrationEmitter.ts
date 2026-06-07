import { EventEmitter } from "events";

/** Emits 'narration' events when AI DM text is ready for a campaign. */
export const narrationEmitter = new EventEmitter();

export interface NarrationReadyPayload {
  campaignId: string;
  eventLogId: string;
  narration: string;
}
