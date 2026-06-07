/**
 * dmService.ts
 *
 * The AI DM service. Handles:
 *   1. Groq API calls (Llama 3.3 70B via OpenAI-compatible endpoint)
 *   2. Output filtering (strip any mechanically dangerous text)
 *   3. Saving narration to event_log.ai_narration (display-only — never parsed)
 *   4. Async queue so game logic never blocks on AI
 *
 * ARCHITECTURE INVARIANT:
 *   The server calculates all game outcomes FIRST.
 *   The server writes to the DB FIRST.
 *   The server broadcasts results to clients FIRST.
 *   THEN dmService.enqueue() is called to add narration asynchronously.
 *   Narration failure must never affect game state. Ever.
 */

import OpenAI from "openai";
import { Pool } from "pg";
import {
  DM_SYSTEM_PROMPT,
  buildCombatStartPrompt,
  buildCombatRoundPrompt,
  buildCombatVictoryPrompt,
  buildCombatDefeatPrompt,
  buildDeathSavePrompt,
  buildMovementPrompt,
  buildSkillCheckPrompt,
  buildActionPrompt,
  buildNemesisAmbushPrompt,
  buildNemesisDefeatedPrompt,
  type CombatNarrationContext,
  type CombatRoundContext,
  type CombatVictoryContext,
  type CombatDefeatContext,
  type DeathSaveContext,
  type MovementNarrationContext,
  type SkillCheckContext,
  type GenericActionContext,
  type NemesisAmbushContext,
  type NemesisDefeatedContext,
} from "./promptTemplates";

// ---------------------------------------------------------------------------
// Groq client setup
// ---------------------------------------------------------------------------

let groqClient: OpenAI | null = null;

function getGroqClient(): OpenAI {
  if (!groqClient) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY not set — AI DM narration is disabled");
    }
    groqClient = new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groqClient;
}

const GROQ_MODEL = "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// Output filter
// ---------------------------------------------------------------------------

/**
 * Strips patterns that would break the "AI is never source of truth" invariant.
 * Applied to every response before it is saved or broadcast.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  // XP / experience
  /\b\d+\s*(?:XP|experience points?|exp)\b/gi,
  // Specific HP / damage / healing numbers
  /\b(?:takes?|deals?|heals?|restores?|loses?)\s+\d+\s*(?:hit\s*points?|HP|damage|health)\b/gi,
  // Roll results
  /\b(?:you\s+)?rolled?\s+a\s+\d+\b/gi,
  /\b(?:total|result)\s*(?:of|:)\s*\d+\b/gi,
  // Quest completion declarations
  /\bquest\s+(?:is\s+)?(?:complete[d]?|fail(?:ed)?|finished?)\b/gi,
  // Direct HP values
  /\b\d+\s*\/\s*\d+\s*(?:HP|hit\s*points?)\b/gi,
  // Death declarations (server decides)
  /\b(?:you\s+)?(?:are|is|has\s+been)\s+(?:dead|killed|slain)\b/gi,
  // Revival declarations
  /\b(?:you\s+)?(?:are|is|has\s+been)\s+(?:revived?|resurrected?|brought\s+back)\b/gi,
];

export function filterNarration(raw: string): string {
  let filtered = raw.trim();
  for (const pattern of FORBIDDEN_PATTERNS) {
    filtered = filtered.replace(pattern, "");
  }
  // Collapse accidental double-spaces from replacements
  filtered = filtered.replace(/  +/g, " ").replace(/ \./g, ".").trim();
  return filtered;
}

// ---------------------------------------------------------------------------
// Core Groq call
// ---------------------------------------------------------------------------

async function callGroq(userPrompt: string): Promise<string> {
  const client = getGroqClient();

  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    max_tokens: 256,
    temperature: 0.82,
    messages: [
      { role: "system", content: DM_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return filterNarration(raw);
}

// ---------------------------------------------------------------------------
// event_log writer
// ---------------------------------------------------------------------------

/**
 * Writes or updates ai_narration on an existing event_log row.
 * The event_log row is created by the game engine BEFORE narration is called.
 * We only fill in the narration column — nothing else.
 */
async function saveNarration(
  pool: Pool,
  eventLogId: string,
  narration: string
): Promise<void> {
  await pool.query(
    `UPDATE event_log SET ai_narration = $1 WHERE id = $2`,
    [narration, eventLogId]
  );
}

// ---------------------------------------------------------------------------
// Async narration queue
// ---------------------------------------------------------------------------

/**
 * Very lightweight in-process queue. One narration runs at a time to avoid
 * hammering the Groq free tier. On failure the error is logged but never
 * propagated — narration is best-effort.
 *
 * Upgrade path: replace with BullMQ + Redis if throughput demands it.
 */

type NarrationJob = () => Promise<void>;
const queue: NarrationJob[] = [];
let queueRunning = false;

async function drainQueue(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      await job();
    } catch (err) {
      // Narration failure must not crash anything
      console.error("[dmService] narration job failed:", err);
    }
  }
  queueRunning = false;
}

function enqueueJob(job: NarrationJob): void {
  queue.push(job);
  // Fire-and-forget: game flow never awaits this
  drainQueue().catch(err =>
    console.error("[dmService] queue drain error:", err)
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * All public functions share this signature pattern:
 *   enqueue<EventType>(pool, eventLogId, ctx)
 *
 * They add a job to the queue and return immediately.
 * The job will call Groq, filter the output, and update event_log.
 */

export const dmService = {
  /**
   * Returns true if GROQ_API_KEY is set. Use to gate narration features
   * in health-check endpoints without silently failing.
   */
  isEnabled(): boolean {
    return Boolean(process.env.GROQ_API_KEY);
  },

  enqueueCombatStart(
    pool: Pool,
    eventLogId: string,
    ctx: CombatNarrationContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildCombatStartPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueCombatRound(
    pool: Pool,
    eventLogId: string,
    ctx: CombatRoundContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildCombatRoundPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueCombatVictory(
    pool: Pool,
    eventLogId: string,
    ctx: CombatVictoryContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildCombatVictoryPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueCombatDefeat(
    pool: Pool,
    eventLogId: string,
    ctx: CombatDefeatContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildCombatDefeatPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueDeathSave(
    pool: Pool,
    eventLogId: string,
    ctx: DeathSaveContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildDeathSavePrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueMovement(
    pool: Pool,
    eventLogId: string,
    ctx: MovementNarrationContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildMovementPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueSkillCheck(
    pool: Pool,
    eventLogId: string,
    ctx: SkillCheckContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildSkillCheckPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueAction(
    pool: Pool,
    eventLogId: string,
    ctx: GenericActionContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildActionPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueNemesisAmbush(
    pool: Pool,
    eventLogId: string,
    ctx: NemesisAmbushContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildNemesisAmbushPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  enqueueNemesisDefeated(
    pool: Pool,
    eventLogId: string,
    ctx: NemesisDefeatedContext
  ): void {
    enqueueJob(async () => {
      const prompt = buildNemesisDefeatedPrompt(ctx);
      const narration = await callGroq(prompt);
      await saveNarration(pool, eventLogId, narration);
    });
  },

  /** Current queue depth — useful for a /health endpoint. */
  queueDepth(): number {
    return queue.length;
  },
};
