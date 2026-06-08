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
import { Pool, PoolClient } from "pg";
import { pool } from "../db/client";
import { narrationEmitter, type NarrationReadyPayload } from "./narrationEmitter";
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
  // Death declarations (server decides) - narrowed to player/agent death declarations only
  /\b(?:you|your character|the party)\s+(?:are|is|has been)\s+(?:dead|killed|slain)\b/gi,
  // Revival declarations
  /\b(?:you\s+)?(?:are|is|has\s+been)\s+(?:revived?|resurrected?|brought\s+back)\b/gi,
];

function getFallbackNarration(eventType: string): string {
  switch (eventType) {
    case "combat_start":
      return "The air grows cold as steel is drawn. Combat begins!";
    case "combat_round":
      return "Blows are exchanged and spells cast as the clash continues.";
    case "combat_victory":
      return "The enemies fall. Against all odds, victory is yours.";
    case "combat_defeat":
      return "Overwhelmed by the foe, the party falls in defeat.";
    case "death_save":
      return "Hovering between life and death, a crucial breath is drawn.";
    case "movement":
      return "The party travels forward, navigating the treacherous terrain.";
    case "skill_check":
      return "With focused effort, the task is attempted.";
    case "action":
      return "An action is taken, reshaping the course of the adventure.";
    case "nemesis_ambush":
      return "A shadow falls over the party. The nemesis strikes from the dark!";
    case "nemesis_defeated":
      return "With a final blow, the dreaded nemesis is defeated.";
    default:
      return "The event unfolds, weaving another thread into the story.";
  }
}

export function filterNarration(raw: string): string {
  let filtered = raw.trim();
  for (const pattern of FORBIDDEN_PATTERNS) {
    filtered = filtered.replace(pattern, "");
  }
  // Collapse accidental double-spaces from replacements
  filtered = filtered.replace(/  +/g, " ").replace(/ \./g, ".").trim();
  return filtered;
}

export function validateAndRepairNarration(raw: string, eventType: string): string {
  let filtered = filterNarration(raw);

  // Check for emptiness or near-emptiness
  if (!filtered || filtered.length < 20) {
    return getFallbackNarration(eventType);
  }

  // Check for broken grammar (double spaces, missing verbs/structure)
  filtered = filtered.replace(/  +/g, " ");
  filtered = filtered.replace(/ ([.,;])/g, "$1");

  // Check for broken sentences
  const sentences = filtered.split(/[.!?]/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) {
    return getFallbackNarration(eventType);
  }

  // Check for orphaned words (a single letter that is not 'a', 'I', 'A', etc.)
  const words = filtered.split(" ");
  if (words.some(w => w.length === 1 && !/[aAI]/.test(w))) {
    return getFallbackNarration(eventType);
  }

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

  return completion.choices[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// event_log writer
// ---------------------------------------------------------------------------

/**
 * Writes or updates ai_narration on an existing event_log row.
 * The event_log row is created by the game engine BEFORE narration is called.
 * We only fill in the narration column — nothing else.
 */
let lastNarrationSuccess: string | null = null;

async function saveNarration(
  pool: any,
  eventLogId: string,
  narration: string,
  campaignId: string
): Promise<void> {
  if (!campaignId) {
    console.error("[dmService] saveNarration called without campaignId — narration saved to DB but will not broadcast");
  }
  await pool.query(
    `UPDATE event_log SET ai_narration = $1 WHERE id = $2`,
    [narration, eventLogId]
  );
  lastNarrationSuccess = new Date().toISOString();
  narrationEmitter.emit("narration", {
    campaignId,
    eventLogId,
    narration,
  } satisfies NarrationReadyPayload);
}

// ---------------------------------------------------------------------------
// Async narration queue (pg-boss-backed)
// ---------------------------------------------------------------------------

import { PgBoss } from "pg-boss";

const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL || "",
});

interface NarrationJobPayload {
  eventLogId: string;
  campaignId: string;
  promptType: string;
  ctx: any;
}

interface IntentClassificationPayload {
  characterId: string;
  campaignId: string;
  actionText: string;
}

async function handleNarrationJob(jobs: any[]): Promise<void> {
  for (const job of jobs) {
    const { eventLogId, campaignId, promptType, ctx } = job.data;

    let prompt = "";
    switch (promptType) {
      case "combat_start":
        prompt = buildCombatStartPrompt(ctx);
        break;
      case "combat_round":
        prompt = buildCombatRoundPrompt(ctx);
        break;
      case "combat_victory":
        prompt = buildCombatVictoryPrompt(ctx);
        break;
      case "combat_defeat":
        prompt = buildCombatDefeatPrompt(ctx);
        break;
      case "death_save":
        prompt = buildDeathSavePrompt(ctx);
        break;
      case "movement":
        prompt = buildMovementPrompt(ctx);
        break;
      case "skill_check":
        prompt = buildSkillCheckPrompt(ctx);
        break;
      case "action":
        prompt = buildActionPrompt(ctx);
        break;
      case "nemesis_ambush":
        prompt = buildNemesisAmbushPrompt(ctx);
        break;
      case "nemesis_defeated":
        prompt = buildNemesisDefeatedPrompt(ctx);
        break;
      default:
        throw new Error(`Unknown promptType: ${promptType}`);
    }

    const raw = await callGroq(prompt);
    const narration = validateAndRepairNarration(raw, promptType);
    await saveNarration(pool, eventLogId, narration, campaignId);
  }
}

async function handleIntentClassificationJob(jobs: any[]): Promise<void> {
  for (const job of jobs) {
    const { characterId, campaignId, actionText } = job.data;
    try {
      const prompt = `Classify the following RPG character action text into D&D behaviour tags (values 0-5):
Action: "${actionText}"
Available tags: mercy, cruelty, greed, loyalty, betrayal, curiosity, cowardice, recklessness, shadow, forbidden, reverence, chaos.
Respond ONLY with a valid JSON object mapping tag names to integer scores. Example: {"shadow": 3, "betrayal": 1}. If no tags apply, return {}. Do not include markdown formatting or extra text.`;
      const client = getGroqClient();
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        max_tokens: 64,
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are a behaviour classification engine. Respond with a JSON object only." },
          { role: "user", content: prompt }
        ]
      });
      const content = completion.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = content.replace(/^```json/, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(cleaned);

      const tags = Object.keys(parsed).filter(k => parsed[k] > 0);
      if (tags.length > 0) {
        const { recordBehaviourEvent } = await import("../game/worldEngine.js");
        for (const tag of tags) {
          const score = Math.min(5, Math.max(1, Number(parsed[tag])));
          await recordBehaviourEvent(pool, campaignId, characterId, "text_intent", [tag], score);
        }
      }
    } catch (err) {
      console.error("[dmService] Intent classification failed:", err);
    }
  }
}

export async function startBoss(): Promise<void> {
  if (!process.env.GROQ_API_KEY) {
    console.warn("[dmService] GROQ_API_KEY not set — pg-boss workers not started");
    return;
  }
  boss.on("error", (error: any) => console.error("[pg-boss] error:", error));
  await boss.start();
  await boss.work("narration", { localConcurrency: 1 }, handleNarrationJob);
  await boss.work("intent-classification", { localConcurrency: 1 }, handleIntentClassificationJob);
  console.log("[dmService] pg-boss queue started and workers registered");
}

export async function stopBoss(): Promise<void> {
  await boss.stop();
  console.log("[dmService] pg-boss queue stopped");
}

function enqueueJob(queueName: string, payload: any): void {
  boss.send(queueName, payload)
    .catch((err: any) => console.error(`[dmService] boss.send failed for queue ${queueName}:`, err));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const dmService = {
  isEnabled(): boolean {
    return Boolean(process.env.GROQ_API_KEY);
  },

  enqueueCombatStart(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: CombatNarrationContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "combat_start", ctx });
  },

  enqueueCombatRound(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: CombatRoundContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "combat_round", ctx });
  },

  enqueueCombatVictory(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: CombatVictoryContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "combat_victory", ctx });
  },

  enqueueCombatDefeat(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: CombatDefeatContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "combat_defeat", ctx });
  },

  enqueueDeathSave(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: DeathSaveContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "death_save", ctx });
  },

  enqueueMovement(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: MovementNarrationContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "movement", ctx });
  },

  enqueueSkillCheck(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: SkillCheckContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "skill_check", ctx });
  },

  enqueueAction(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: GenericActionContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "action", ctx });
  },

  enqueueNemesisAmbush(
    pool: any,
    eventLogId: string,
    campaignId: string,
    ctx: NemesisAmbushContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "nemesis_ambush", ctx });
  },

  enqueueNemesisDefeated(
    pool: Pool,
    eventLogId: string,
    campaignId: string,
    ctx: NemesisDefeatedContext
  ): void {
    enqueueJob("narration", { eventLogId, campaignId, promptType: "nemesis_defeated", ctx });
  },

  enqueueIntentClassification(
    pool: Pool,
    characterId: string,
    campaignId: string,
    actionText: string
  ): void {
    if (!this.isEnabled()) return;
    enqueueJob("intent-classification", { characterId, campaignId, actionText });
  },

  async queueDepth(): Promise<number> {
    try {
      const res = await pool.query(
        "SELECT COUNT(*) FROM pgboss.job WHERE state IN ('created', 'retry', 'active')"
      );
      return parseInt(res.rows[0].count, 10);
    } catch (err) {
      console.error("[dmService] failed to get queue depth:", err);
      return 0;
    }
  },

  getLastSuccess(): string | null {
    return lastNarrationSuccess;
  },

  /**
   * Generates a session summary narrative directly (awaitable).
   * Used by encyclopediaEngine.generateSessionSummary().
   * Does NOT use the event_log queue — returns text directly.
   */
  async generateSessionSummary(prompt: string): Promise<string> {
    const client = getGroqClient();
    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 800,
      temperature: 0.75,
      messages: [
        {
          role: "system",
          content:
            "You are a historian chronicling a D&D campaign. Write in past tense, third person. Be engaging and narrative-driven. Do not mention game mechanics, dice rolls, or numbers.",
        },
        { role: "user", content: prompt },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    return raw.trim();
  },
};
