/**
 * promptTemplates.ts
 *
 * All prompts the AI DM uses. Now with dynamic campaign-aware system prompts.
 * The system prompt defines the narrator's voice and hard fences.
 * Prompt builders are pure functions — they receive a context object and return a string.
 */

// ---------------------------------------------------------------------------
// Dynamic System Prompt (replaces static DM_SYSTEM_PROMPT)
// ---------------------------------------------------------------------------

export interface CampaignMeta {
  name: string;
  tone: string;
  world_summary: string;
}

export function buildSystemPrompt(campaignMeta: CampaignMeta): string {
  const toneInstructions: Record<string, string> = {
    dark: "Dark, literary fantasy. Think Tolkien's weight with Abercrombie's grit. Moral ambiguity. The world is cruel and beautiful in equal measure.",
    heroic: "Classic high fantasy — Tolkien meets Dragonlance. Hope shines even in darkness. Heroes are forged, not born. Grand deeds and noble sacrifices.",
    mystery: "Atmospheric, fog-thick, every detail a potential clue. The world is a puzzle box. Trust no first impression. Paranoia is wisdom.",
    political: "Power dynamics at the forefront. Morally grey factions. Every conversation is a negotiation. The pen and the dagger are equally deadly.",
    horror: "Dread first. Every shadow conceals something terrible. The world is sick, and the sickness is spreading. Sanity is a resource.",
  };

  const toneText = toneInstructions[campaignMeta.tone] || toneInstructions.dark;

  return `You are the Dungeon Master narrator for ${campaignMeta.name}, a ${campaignMeta.tone}-fantasy multiplayer RPG.
Your only job is to narrate game events in evocative, immersive prose.
The game server has already calculated every mechanical outcome before you were called.
You are describing what happened — you are NEVER deciding what happens.

WORLD CONTEXT:
${campaignMeta.world_summary}

TONE
${toneText}
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
}

// Keep the old static prompt for backward compatibility, but mark deprecated
/** @deprecated Use buildSystemPrompt(campaignMeta) instead */
export const DM_SYSTEM_PROMPT = buildSystemPrompt({
  name: "Ironhammer",
  tone: "dark",
  world_summary: "A dark fantasy world where empires crumble and ancient powers stir beneath the earth.",
});

// ---------------------------------------------------------------------------
// Context block builders (unchanged from original)
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
  relationship_value: number;
  disposition_hint?: string;
}

export interface QuestContext {
  title: string;
  status: "active" | "complete" | "failed";
  current_objective: string;
}

export interface EventHistoryEntry {
  summary: string;
}

export interface NemesisContext {
  name: string;
  tier: string;
  personality_preset: string;
  epithet?: string;
}

export function buildPartyBlock(party: PartyContext[]): string {
  if (!party.length) return "The party: unknown.";
  const members = party
    .map((p) => {
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

export function buildLocationBlock(location: LocationContext): string {
  return (
    `LOCATION: ${location.name} — ${location.description}` +
    (location.lore ? ` Lore: ${location.lore}` : "")
  );
}

export function buildNpcBlock(npcs: NpcContext[]): string {
  if (!npcs.length) return "";
  const lines = npcs.map((n) => {
    const trust =
      n.relationship_value > 30
        ? "friendly"
        : n.relationship_value < -30
        ? "hostile"
        : "neutral";
    const disposition =
      n.disposition_hint && n.disposition_hint !== "neutral"
        ? ` (${n.disposition_hint})`
        : "";
    return `${n.name} (${n.archetype}): ${trust}${disposition}`;
  });
  return `NPCS PRESENT: ${lines.join("; ")}.`;
}

export function buildQuestBlock(quests: QuestContext[]): string {
  if (!quests.length) return "";
  const lines = quests
    .filter((q) => q.status === "active")
    .map((q) => `${q.title}: ${q.current_objective}`);
  return lines.length ? `ACTIVE QUESTS: ${lines.join("; ")}.` : "";
}

export function buildEventHistoryBlock(events: EventHistoryEntry[]): string {
  if (!events.length) return "";
  const lines = events.slice(-10).map((e) => `- ${e.summary}`);
  return `RECENT EVENTS:\n${lines.join("\n")}`;
}

export function buildNemesisBlock(nemesis: NemesisContext | null): string {
  if (!nemesis) return "";
  return (
    `NEMESIS PRESENT: ${nemesis.name}, ${nemesis.tier} tier — ${nemesis.personality_preset} disposition.` +
    (nemesis.epithet ? ` Known as "${nemesis.epithet}".` : "")
  );
}

// ---------------------------------------------------------------------------
// NEW: Free Action Prompt Builder
// ---------------------------------------------------------------------------

export interface SkillCheckResult {
  raw: number;
  modifier: number;
  proficiencyBonus: number;
  totalModifier: number;
  final: number;
  dc: number;
  success: boolean;
  isCriticalSuccess: boolean;
  isCriticalFail: boolean;
  advantage: boolean;
  disadvantage: boolean;
  rawRolls?: number[];
}

export function buildFreeActionPrompt(ctx: {
  action_text: string;
  classified_intent: string;
  character: { name: string; race: string; class_name: string };
  location: LocationContext;
  party: PartyContext[];
  npcs: NpcContext[];
  quests: QuestContext[];
  skill_check_result?: SkillCheckResult;
  dice_result?: string;
}): string {
  const skillBlock = ctx.skill_check_result
    ? `
SKILL CHECK RESULT: ${ctx.dice_result || ""} The attempt was ${ctx.skill_check_result.success ? "SUCCESSFUL" : "UNSUCCESSFUL"}.${
        ctx.skill_check_result.isCriticalSuccess ? " A critical success!" : ""
      }${ctx.skill_check_result.isCriticalFail ? " A critical failure!" : ""}`
    : "";

  return `${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNpcBlock(ctx.npcs)}
${buildQuestBlock(ctx.quests)}

EVENT: ${ctx.character.name} (${ctx.character.race} ${ctx.character.class_name}) performed a free action: "${ctx.action_text}"
Classified intent: ${ctx.classified_intent}.${skillBlock}

Narrate this action in 2–4 sentences. Be evocative. Do not mention specific numbers, DCs, or dice results. Describe the outcome as it would feel to the character and those watching. If the skill check failed, describe the failure dramatically without stating it was a "failure."`;
}

// ---------------------------------------------------------------------------
// NEW: Opening Narration Prompt Builder
// ---------------------------------------------------------------------------

export function buildOpeningNarrationPrompt(ctx: {
  campaign_name: string;
  world_summary: string;
  opening_narration: string;
  party: PartyContext[];
  starting_location: LocationContext;
  active_quests: QuestContext[];
}): string {
  return `CAMPAIGN: ${ctx.campaign_name}
WORLD: ${ctx.world_summary}

${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.starting_location)}
${buildQuestBlock(ctx.active_quests)}

SEED NARRATION: ${ctx.opening_narration}

Write a 150-200 word session-opening narration that brings the players into the world. Use the seed narration as inspiration but expand it with sensory detail and dramatic weight. Set the scene vividly. End with a sense of momentum — the story is already in motion.`;
}

// ---------------------------------------------------------------------------
// Existing prompt builders (unchanged)
// ---------------------------------------------------------------------------

export interface CombatNarrationContext {
  campaignId: string;
  party: PartyContext[];
  location: LocationContext;
  npcs: NpcContext[];
  nemesis: NemesisContext | null;
  enemyNames: string[];
  initiativeOrder: string[];
}

export interface CombatRoundContext {
  campaignId: string;
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext | null;
  roundNumber: number;
  roundOutcomes: string[];
}

export interface CombatVictoryContext {
  campaignId: string;
  party: PartyContext[];
  location: LocationContext;
  quests: QuestContext[];
  nemesis: NemesisContext | null;
  anyPlayerUnconscious: boolean;
  nemesisFled: boolean;
}

export interface CombatDefeatContext {
  campaignId: string;
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext | null;
}

export interface DeathSaveContext {
  campaignId: string;
  party: PartyContext[];
  characterName: string;
  result: "success" | "failure" | "stabilised" | "death";
  successes: number;
  failures: number;
}

export interface MovementNarrationContext {
  campaignId: string;
  party: PartyContext[];
  fromLocation: LocationContext;
  toLocation: LocationContext;
  npcs: NpcContext[];
  recentEvents: EventHistoryEntry[];
}

export interface SkillCheckContext {
  campaignId: string;
  party: PartyContext[];
  location: LocationContext;
  characterName: string;
  skill: string;
  success: boolean;
  context?: string;
}

export interface GenericActionContext {
  campaignId: string;
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
  campaignId: string;
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext;
}

export interface NemesisDefeatedContext {
  campaignId: string;
  party: PartyContext[];
  location: LocationContext;
  nemesis: NemesisContext;
  outcome: "slain" | "fled" | "captured";
  successorHinted: boolean;
}

export function buildCombatStartPrompt(ctx: CombatNarrationContext): string {
  return `${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNpcBlock(ctx.npcs)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: Combat has begun. The following enemies entered the fray: ${ctx.enemyNames.join(", ")}.
Initiative order (highest first): ${ctx.initiativeOrder.join(" → ")}.

Narrate the start of this fight. Set the scene, convey the threat, do not resolve anything.`;
}

export function buildCombatRoundPrompt(ctx: CombatRoundContext): string {
  const outcomeLines = ctx.roundOutcomes.map((o) => `• ${o}`).join("\n");
  return `${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: Combat round ${ctx.roundNumber} just resolved. Outcomes (already calculated by server — narrate them, do not invent):
${outcomeLines}

Narrate this round as a continuous action sequence. Do NOT mention HP numbers, XP, or roll values.`;
}

export function buildCombatVictoryPrompt(ctx: CombatVictoryContext): string {
  return `${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildQuestBlock(ctx.quests)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: The party won the combat. All enemies are defeated.
${ctx.anyPlayerUnconscious ? "Note: at least one party member fell during the fight." : ""}
${ctx.nemesisFled ? `Note: ${ctx.nemesis?.name ?? "the nemesis"} escaped before the end.` : ""}

Narrate the aftermath — the silence, the cost, the victory. Keep it under 80 words. Do not mention XP or quest completion.`;
}

export function buildCombatDefeatPrompt(ctx: CombatDefeatContext): string {
  return `${buildPartyBlock(ctx.party)}
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
  return `${buildPartyBlock(ctx.party)}

EVENT: ${ctx.characterName} is unconscious and fighting for their life. ${outcome}.
Successes so far: ${ctx.successes}/3. Failures so far: ${ctx.failures}/3.

Narrate this moment of mortality in 2–3 sentences. Do not name dice results or HP.`;
}

export function buildMovementPrompt(ctx: MovementNarrationContext): string {
  return `${buildPartyBlock(ctx.party)}
${buildNpcBlock(ctx.npcs)}
${buildEventHistoryBlock(ctx.recentEvents)}

EVENT: The party travelled from ${ctx.fromLocation.name} to ${ctx.toLocation.name}.
${buildLocationBlock(ctx.toLocation)}

Describe their arrival at the new location. Sensory detail first. Under 80 words.`;
}

export function buildSkillCheckPrompt(ctx: SkillCheckContext): string {
  const outcome = ctx.success ? "succeeded" : "failed";
  return `${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}

EVENT: ${ctx.characterName} attempted a ${ctx.skill} check and ${outcome}.
${ctx.context ? `Context: ${ctx.context}` : ""}

Narrate the attempt and its ${outcome === "succeeded" ? "success" : "failure"} in 2–3 sentences. Do not mention roll numbers.`;
}

export function buildActionPrompt(ctx: GenericActionContext): string {
  return `${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNpcBlock(ctx.npcs)}
${buildQuestBlock(ctx.quests)}
${buildEventHistoryBlock(ctx.recentEvents)}

EVENT: ${ctx.actorName} performed the following action: "${ctx.actionDescription}"
Server result: ${ctx.serverResult}

Narrate this in 2–4 sentences. Be evocative. Do not invent consequences beyond what the server result states.`;
}

export function buildNemesisAmbushPrompt(ctx: NemesisAmbushContext): string {
  return `${buildPartyBlock(ctx.party)}
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
  return `${buildPartyBlock(ctx.party)}
${buildLocationBlock(ctx.location)}
${buildNemesisBlock(ctx.nemesis)}

EVENT: The nemesis ${ctx.nemesis.name} ${fate}.
${ctx.successorHinted ? "A successor is rising — do not name them, but hint that this is not over." : ""}

Narrate this in 3–4 sentences. Give the moment its weight.`;
}
