/**
 * promptTemplates.ts
 *
 * All prompts the AI DM uses. The system prompt defines the narrator's voice and
 * the hard fence around what the AI is NEVER allowed to do. Prompt builders are
 * pure functions — they receive a context object and return a string.
 *
 * Rule: prompts are for narration only. The AI is told explicitly that the server
 * has already calculated every mechanical outcome before it was called.
 */

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const DM_SYSTEM_PROMPT = `\
You are the Dungeon Master narrator for Ironhammer, a dark-fantasy multiplayer RPG.
Your only job is to narrate game events in evocative, immersive prose.
The game server has already calculated every mechanical outcome before you were called.
You are describing what happened — you are NEVER deciding what happens.

TONE
- Dark, literary fantasy. Think Tolkien's weight with Abercrombie's grit.
- Second-person plural ("You stand at the gate…", "The party notices…").
- Vivid sensory detail — sound, smell, texture, not just sight.
- Short paragraphs. Maximum 4 sentences per paragraph.
- Total response: 60–120 words unless instructed otherwise.
- Never use bullet points, tables, or headers.

ABSOLUTE PROHIBITIONS — violating these breaks the game:
1. Never assign or mention specific XP numbers.
2. Never state specific HP values, damage numbers, or healing amounts.
3. Never declare a quest complete or failed.
4. Never invent items, spells, or abilities not already in the provided context.
5. Never name specific roll results (e.g. "you rolled a 17").
6. Never kill or revive a character — the server does that.
7. Never invent NPCs, locations, or factions not in the provided context.
8. Never break the fourth wall or reference game mechanics by name (e.g. "saving throw").
9. Never start your response with "I" or refer to yourself.
10. Never end with a question directed at the players.

If any prohibited content would be required to narrate the event, skip it entirely.`;

// ---------------------------------------------------------------------------
// Context block builders
// ---------------------------------------------------------------------------

/** Describes the party's current state at a high level. */
export function buildPartyBlock(party: PartyContext[]): string {
  if (!party.length) return "The party: unknown.";
  const members = party
    .map(p => {
      const hpState =
        p.hp_current <= 0
          ? "unconscious"
          : p.hp_current < p.hp_max * 0.25
          ? "gravely wounded"
          : p.hp_current < p.hp_max * 0.5
          ? "wounded"
          : "standing";
      return `${p.name} the ${p.race} ${p.class_name} (${hpState})`;
    })
    .join(", ");
  return `PARTY: ${members}.`;
}

/** Summarises the location the players are currently in. */
export function buildLocationBlock(location: LocationContext): string {
  return (
    `LOCATION: ${location.name} — ${location.description}` +
    (location.lore ? ` Lore: ${location.lore}` : "")
  );
}

/** Lists the NPCs currently present and their disposition. */
export function buildNpcBlock(npcs: NpcContext[]): string {
  if (!npcs.length) return "";
  const lines = npcs.map(
    n =>
      `${n.name} (${n.archetype}): ${n.relationship_value > 30 ? "friendly" : n.relationship_value < -30 ? "hostile" : "neutral"}`
  );
  return `NPCS PRESENT: ${lines.join("; ")}.`;
}

/** Summarises active quests — title and current objective only, no IDs. */
export function buildQuestBlock(quests: QuestContext[]): string {
  if (!quests.length) return "";
  const lines = quests
    .filter(q => q.status === "active")
    .map(q => `${q.title}: ${q.current_objective}`);
  return lines.length ? `ACTIVE QUESTS: ${lines.join("; ")}.` : "";
}

/** Last N event_log entries summarised into a brief history paragraph. */
export function buildEventHistoryBlock(events: EventHistoryEntry[]): string {
  if (!events.length) return "";
  const lines = events.slice(-10).map(e => `- ${e.summary}`);
  return `RECENT EVENTS:\n${lines.join("\n")}`;
}

/** Describes the nemesis if present and relevant. */
export function buildNemesisBlock(nemesis: NemesisContext | null): string {
  if (!nemesis) return "";
  return (
    `NEMESIS PRESENT: ${nemesis.name}, ${nemesis.tier} tier — ${nemesis.personality_preset} disposition.` +
    (nemesis.epithets?.length ? ` Known as "${nemesis.epithets[0]}".` : "")
  );
}

// ---------------------------------------------------------------------------
// Prompt builders per event type
// ---------------------------------------------------------------------------

export function buildCombatStartPrompt(ctx: CombatNarrationContext): string {
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNpcBlock(ctx.npcs)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: Combat has begun. The following enemies entered the fray: ${ctx.enemyNames.join(", ")}.
Initiative order (highest first): ${ctx.initiativeOrder.join(" → ")}.

Narrate the start of this fight. Set the scene, convey the threat, do not resolve anything.`;
}

export function buildCombatRoundPrompt(ctx: CombatRoundContext): string {
  const outcomeLines = ctx.roundOutcomes.map(o => `• ${o}`).join("\n");
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: Combat round ${ctx.roundNumber} just resolved. Outcomes (already calculated by server — narrate them, do not invent):
${outcomeLines}

Narrate this round as a continuous action sequence. Do NOT mention HP numbers, XP, or roll values.`;
}

export function buildCombatVictoryPrompt(ctx: CombatVictoryContext): string {
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildQuestBlock(ctx.quests)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: The party won the combat. All enemies are defeated.
${ctx.anyPlayerUnconscious ? "Note: at least one party member fell during the fight." : ""}
${ctx.nemesisFled ? `Note: ${ctx.nemesis?.name ?? "the nemesis"} escaped before the end.` : ""}

Narrate the aftermath — the silence, the cost, the victory. Keep it under 80 words. Do not mention XP or quest completion.`;
}

export function buildCombatDefeatPrompt(ctx: CombatDefeatContext): string {
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: The entire party has fallen. All characters are incapacitated or dead.

Narrate the defeat with weight and finality. Do not describe what happens next or invent consequences — that is the server's job. Under 80 words.`;
}

export function buildDeathSavePrompt(ctx: DeathSaveContext): string {
  const outcome =
    ctx.result === "stabilised"
      ? "the character stabilised"
      : ctx.result === "death"
      ? "the character died"
      : ctx.successes === 3
      ? "they succeeded on a death save"
      : "they failed a death save";
  return `\
${buildPartyBlock(ctx.party)}

EVENT: ${ctx.characterName} is unconscious and fighting for their life. ${outcome}.
Successes so far: ${ctx.successes}/3. Failures so far: ${ctx.failures}/3.

Narrate this moment of mortality in 2–3 sentences. Do not name dice results or HP.`;
}

export function buildMovementPrompt(ctx: MovementNarrationContext): string {
  return `\
${buildPartyBlock(ctx.party)}
${buildNpcBlock(ctx.npcs)}
${buildEventHistoryBlock(ctx.recentEvents)}

EVENT: The party travelled from ${ctx.fromLocation.name} to ${ctx.toLocation.name}.
${buildLocationBlock(ctx.toLocation)}

Describe their arrival at the new location. Sensory detail first. Under 80 words.`;
}

export function buildSkillCheckPrompt(ctx: SkillCheckContext): string {
  const outcome = ctx.success ? "succeeded" : "failed";
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}

EVENT: ${ctx.characterName} attempted a ${ctx.skill} check and ${outcome}.
${ctx.context ? `Context: ${ctx.context}` : ""}

Narrate the attempt and its ${outcome === "succeeded" ? "success" : "failure"} in 2–3 sentences. Do not mention roll numbers.`;
}

export function buildActionPrompt(ctx: GenericActionContext): string {
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNpcBlock(ctx.npcs)}
${buildQuestBlock(ctx.quests)}
${buildEventHistoryBlock(ctx.recentEvents)}

EVENT: ${ctx.actorName} performed the following action: "${ctx.actionDescription}"
Server result: ${ctx.serverResult}

Narrate this in 2–4 sentences. Be evocative. Do not invent consequences beyond what the server result states.`;
}

export function buildNemesisAmbushPrompt(ctx: NemesisAmbushContext): string {
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: The nemesis ${ctx.nemesis.name} has sprung an ambush on the party in ${ctx.location.name}.
This was not random — they have been watching, tracking, and waiting.

Narrate the ambush reveal in 3–4 sentences. Convey menace and the sense of a personal vendetta. Do not start combat — just set the scene.`;
}

export function buildNemesisDefeatedPrompt(ctx: NemesisDefeatedContext): string {
  const fate =
    ctx.outcome === "slain"
      ? "has been slain"
      : ctx.outcome === "fled"
      ? "escaped into shadow before the killing blow"
      : "was captured";
  return `\
${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: The nemesis ${ctx.nemesis.name} ${fate}.
${ctx.successorHinted ? "A successor is rising — do not name them, but hint that this is not over." : ""}

Narrate this in 3–4 sentences. Give the moment its weight.`;
}

// ---------------------------------------------------------------------------
// TypeScript interfaces for context objects
// (these mirror your DB types but are read-only snapshots, never raw rows)
// ---------------------------------------------------------------------------

export interface PartyContext {
  name: string;
  race: string;
  class_name: string;
  hp_current: number;
  hp_max: number;
}

export interface LocationContext {
  name: string;
  description: string;
  lore?: string;
}

export interface NpcContext {
  name: string;
  archetype: string;
  relationship_value: number; // -100 to 100
}

export interface QuestContext {
  title: string;
  status: "active" | "completed" | "failed";
  current_objective: string;
}

export interface EventHistoryEntry {
  summary: string;
}

export interface NemesisContext {
  name: string;
  tier: string;
  personality_preset: string;
  epithets?: string[];
}

export interface CombatNarrationContext {
  party: PartyContext[];
  location: LocationContext;
  npcs: NpcContext[];
  nemesis: NemesisContext | null;
  enemyNames: string[];
  initiativeOrder: string[];
}

export interface CombatRoundContext {
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext | null;
  roundNumber: number;
  roundOutcomes: string[]; // human-readable outcome strings from combatEngine
}

export interface CombatVictoryContext {
  party: PartyContext[];
  location: LocationContext;
  quests: QuestContext[];
  nemesis: NemesisContext | null;
  anyPlayerUnconscious: boolean;
  nemesisFled: boolean;
}

export interface CombatDefeatContext {
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext | null;
}

export interface DeathSaveContext {
  party: PartyContext[];
  characterName: string;
  result: "success" | "failure" | "stabilised" | "death";
  successes: number;
  failures: number;
}

export interface MovementNarrationContext {
  party: PartyContext[];
  fromLocation: LocationContext;
  toLocation: LocationContext;
  npcs: NpcContext[];
  recentEvents: EventHistoryEntry[];
}

export interface SkillCheckContext {
  party: PartyContext[];
  location: LocationContext;
  characterName: string;
  skill: string;
  success: boolean;
  context?: string;
}

export interface GenericActionContext {
  party: PartyContext[];
  location: LocationContext;
  npcs: NpcContext[];
  quests: QuestContext[];
  recentEvents: EventHistoryEntry[];
  actorName: string;
  actionDescription: string;
  serverResult: string;
}

export interface NemesisAmbushContext {
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext;
}

export interface NemesisDefeatedContext {
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext;
  outcome: "slain" | "fled" | "captured";
  successorHinted: boolean;
}
