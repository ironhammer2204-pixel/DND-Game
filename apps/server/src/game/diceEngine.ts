/**
 * diceEngine.ts
 *
 * Canonical dice engine for Ironhammer. ALL game rolls MUST go through this module.
 * No other file should use Math.random() for game rolls.
 *
 * Uses crypto-quality randomness. No bias. D&D 5e standard formulas.
 */

import { randomInt } from "crypto";
import { DiceType } from "@dnd/shared";
import { RoomManager } from "../websocket/roomManager";

// ============================================================
// CORE ROLLERS
// ============================================================

/**
 * Roll a single die of N sides using cryptographically secure randomness.
 */
export function rollDie(sides: number): number {
  if (sides < 1) throw new Error("Die must have at least 1 side");
  return randomInt(1, sides + 1);
}

/**
 * Roll multiple dice, return array of individual results.
 */
export function rollMultipleDice(count: number, sides: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    results.push(rollDie(sides));
  }
  return results;
}

/**
 * Roll multiple dice and sum them.
 */
export function sumDice(count: number, sides: number): number {
  return rollMultipleDice(count, sides).reduce((sum, r) => sum + r, 0);
}

// ============================================================
// NAMED DICE
// ============================================================

export function d4(): number { return rollDie(4); }
export function d6(): number { return rollDie(6); }
export function d8(): number { return rollDie(8); }
export function d10(): number { return rollDie(10); }
export function d12(): number { return rollDie(12); }
export function d20(): number { return rollDie(20); }
export function d100(): number { return rollDie(100); }

// ============================================================
// ADVANTAGE / DISADVANTAGE
// ============================================================

export interface AdvantageResult {
  rolls: [number, number];
  result: number;
  used: "higher" | "lower";
}

function rollD20WithAdvantagePair(): AdvantageResult {
  const r1 = d20();
  const r2 = d20();
  const result = Math.max(r1, r2);
  return { rolls: [r1, r2], result, used: result === r1 ? "higher" : "lower" };
}

function rollD20WithDisadvantagePair(): AdvantageResult {
  const r1 = d20();
  const r2 = d20();
  const result = Math.min(r1, r2);
  return { rolls: [r1, r2], result, used: result === r1 ? "lower" : "higher" };
}

// ============================================================
// ABILITY MODIFIERS & PROFICIENCY
// ============================================================

/**
 * D&D 5e ability modifier: floor((score - 10) / 2)
 */
export function getAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * D&D 5e proficiency bonus by level.
 */
export function getProficiencyBonus(level: number): number {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

// ============================================================
// SKILL CHECK RESOLUTION
// ============================================================

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

export function resolveSkillCheck(
  abilityScore: number,
  level: number,
  proficient: boolean,
  dc: number,
  advantage = false,
  disadvantage = false
): SkillCheckResult {
  const modifier = getAbilityModifier(abilityScore);
  const proficiencyBonus = proficient ? getProficiencyBonus(level) : 0;
  const totalModifier = modifier + proficiencyBonus;

  let raw: number;
  let rawRolls: number[] | undefined;

  if (advantage && !disadvantage) {
    const adv = rollD20WithAdvantagePair();
    raw = adv.result;
    rawRolls = adv.rolls;
  } else if (disadvantage && !advantage) {
    const dis = rollD20WithDisadvantagePair();
    raw = dis.result;
    rawRolls = dis.rolls;
  } else {
    raw = d20();
  }

  const final = raw + totalModifier;
  const isCriticalSuccess = raw === 20;
  const isCriticalFail = raw === 1;

  // Critical success always succeeds; critical fail always fails (unless house-ruled)
  const success = isCriticalSuccess ? true : isCriticalFail ? false : final >= dc;

  return {
    raw,
    modifier,
    proficiencyBonus,
    totalModifier,
    final,
    dc,
    success,
    isCriticalSuccess,
    isCriticalFail,
    advantage,
    disadvantage,
    rawRolls,
  };
}

// ============================================================
// ATTACK ROLL RESOLUTION
// ============================================================

export interface AttackRollResult {
  raw: number;
  attackBonus: number;
  total: number;
  targetAC: number;
  hit: boolean;
  critHit: boolean;
  critMiss: boolean;
  rawRolls?: number[];
  advantage: boolean;
  disadvantage: boolean;
}

export function resolveAttackRoll(
  attackBonus: number,
  targetAC: number,
  advantage = false,
  disadvantage = false
): AttackRollResult {
  let raw: number;
  let rawRolls: number[] | undefined;

  if (advantage && !disadvantage) {
    const adv = rollD20WithAdvantagePair();
    raw = adv.result;
    rawRolls = adv.rolls;
  } else if (disadvantage && !advantage) {
    const dis = rollD20WithDisadvantagePair();
    raw = dis.result;
    rawRolls = dis.rolls;
  } else {
    raw = d20();
  }

  const total = raw + attackBonus;
  const critHit = raw === 20;
  const critMiss = raw === 1;
  const hit = critHit ? true : critMiss ? false : total >= targetAC;

  return {
    raw,
    attackBonus,
    total,
    targetAC,
    hit,
    critHit,
    critMiss,
    rawRolls,
    advantage,
    disadvantage,
  };
}

// ============================================================
// DAMAGE ROLL RESOLUTION
// ============================================================

export interface DamageRollResult {
  dice: string;
  rolls: number[];
  bonus: number;
  final: number;
  isCrit: boolean;
}

/**
 * Parse a dice expression like "1d8", "2d6", "1d4+2" and roll it.
 * On crit, double the dice count (e.g. "1d8" becomes "2d8").
 */
export function resolveDamageRoll(
  diceExpression: string,
  bonus = 0,
  isCrit = false
): DamageRollResult {
  const match = diceExpression.match(/^(\d+)d(\d+)(?:\+(-?\d+))?$/i);
  if (!match) {
    // Fallback: try to parse as flat number or simple NdN
    const simpleMatch = diceExpression.match(/^(\d+)d(\d+)$/i);
    if (!simpleMatch) {
      throw new Error(`Invalid dice expression: ${diceExpression}`);
    }
    const count = parseInt(simpleMatch[1], 10);
    const sides = parseInt(simpleMatch[2], 10);
    const actualCount = isCrit ? count * 2 : count;
    const rolls = rollMultipleDice(actualCount, sides);
    return { dice: `${actualCount}d${sides}`, rolls, bonus, final: rolls.reduce((s, r) => s + r, 0) + bonus, isCrit };
  }

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const exprBonus = match[3] ? parseInt(match[3], 10) : 0;
  const totalBonus = bonus + exprBonus;
  const actualCount = isCrit ? count * 2 : count;

  const rolls = rollMultipleDice(actualCount, sides);
  return {
    dice: `${actualCount}d${sides}`,
    rolls,
    bonus: totalBonus,
    final: rolls.reduce((s, r) => s + r, 0) + totalBonus,
    isCrit,
  };
}

// ============================================================
// DEATH SAVING THROW
// ============================================================

export interface DeathSaveResult {
  raw: number;
  success: boolean;
  critSuccess: boolean;
  critFail: boolean;
}

export function resolveDeathSave(): DeathSaveResult {
  const raw = d20();
  return {
    raw,
    success: raw >= 10,
    critSuccess: raw === 20,
    critFail: raw === 1,
  };
}

// ============================================================
// INITIATIVE
// ============================================================

export interface InitiativeResult {
  raw: number;
  modifier: number;
  total: number;
}

export function rollInitiative(dexScore: number): InitiativeResult {
  const modifier = getAbilityModifier(dexScore);
  const raw = d20();
  return { raw, modifier, total: raw + modifier };
}

// ============================================================
// ABILITY SCORE GENERATION
// ============================================================

/**
 * Roll 4d6, drop the lowest. Standard D&D 5e ability score generation.
 */
export function rollAbilityScore(): number {
  const rolls = rollMultipleDice(4, 6);
  rolls.sort((a, b) => a - b);
  rolls.shift(); // drop lowest
  return rolls.reduce((s, r) => s + r, 0);
}

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

// ============================================================
// SKILL KEYWORD PARSER (for actionProcessor)
// ============================================================

export const SKILL_KEYWORD_MAP: Record<string, string> = {
  // Athletics (STR)
  climb: "athletics",
  jump: "athletics",
  shove: "athletics",
  grapple: "athletics",
  swim: "athletics",
  lift: "athletics",
  break: "athletics",
  // Stealth (DEX)
  hide: "stealth",
  sneak: "stealth",
  silent: "stealth",
  creep: "stealth",
  shadow: "stealth",
  // Acrobatics (DEX)
  tumble: "acrobatics",
  flip: "acrobatics",
  balance: "acrobatics",
  // Sleight of Hand (DEX)
  pickpocket: "sleightOfHand",
  steal: "sleightOfHand",
  palm: "sleightOfHand",
  // Perception (WIS)
  spot: "perception",
  notice: "perception",
  watch: "perception",
  search: "perception",
  listen: "perception",
  sense: "perception",
  // Survival (WIS)
  track: "survival",
  forage: "survival",
  navigate: "survival",
  hunt: "survival",
  // Medicine (WIS)
  heal: "medicine",
  bandage: "medicine",
  treat: "medicine",
  diagnose: "medicine",
  // Insight (WIS)
  read: "insight",
  sense_motive: "insight",
  // Deception (CHA)
  lie: "deception",
  deceive: "deception",
  bluff: "deception",
  fake: "deception",
  // Persuasion (CHA)
  persuade: "persuasion",
  negotiate: "persuasion",
  charm: "persuasion",
  beg: "persuasion",
  convince: "persuasion",
  talk: "persuasion",
  // Intimidation (CHA/STR)
  intimidate: "intimidation",
  threaten: "intimidation",
  menace: "intimidation",
  scare: "intimidation",
  // Arcana (INT)
  arcane: "arcana",
  magic: "arcana",
  spell: "arcana",
  // History (INT)
  recall: "history",
  know: "history",
  lore: "history",
  past: "history",
  // Investigation (INT)
  investigate: "investigation",
  examine: "investigation",
  deduce: "investigation",
  analyze: "investigation",
  inspect: "investigation",
  // Nature (INT)
  nature: "nature",
  plant: "nature",
  beast: "nature",
  // Religion (INT)
  religion: "religion",
  god: "religion",
  divine: "religion",
  // Performance (CHA)
  perform: "performance",
  entertain: "performance",
  play: "performance",
  sing: "performance",
  dance: "performance",
  // Animal Handling (WIS)
  animal: "animalHandling",
  tame: "animalHandling",
  ride: "animalHandling",
};

/**
 * Parse free-form action text to determine which skill is being used.
 */
export function parseSkillFromText(text: string): string {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, "");
    if (SKILL_KEYWORD_MAP[clean]) {
      return SKILL_KEYWORD_MAP[clean];
    }
  }

  // Check for compound phrases
  if (lower.includes("pick lock") || lower.includes("disarm trap") || lower.includes("lockpick")) {
    return "sleightOfHand";
  }
  if (lower.includes("first aid") || lower.includes("stabilize")) {
    return "medicine";
  }

  // Default
  return "perception";
}

/**
 * Determine DC from action text context.
 */
export function determineDCFromText(text: string): number {
  const lower = text.toLowerCase();
  if (lower.includes("impossible") || lower.includes("legendary") || lower.includes("miracle")) return 30;
  if (lower.includes("very hard") || lower.includes("nearly impossible")) return 25;
  if (lower.includes("hard") || lower.includes("difficult") || lower.includes("challenging")) return 20;
  if (lower.includes("easy") || lower.includes("simple") || lower.includes("basic") || lower.includes("trivial")) return 10;
  return 15; // moderate default
}

// ============================================================
// DICE ROLL BROADCAST HELPER
// ============================================================

export interface DiceRollPayload {
  dice_type: "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d100";
  raw: number;
  modifier: number;
  final: number;
  roller_name: string;
  context: string;
  campaign_id: string;
  character_id?: string;
  roll_breakdown?: {
    raw_rolls?: number[];
    ability_modifier?: number;
    proficiency_bonus?: number;
    dc?: number;
    success?: boolean;
    is_crit?: boolean;
    is_fumble?: boolean;
  };
}

export function broadcastDiceRoll(campaignId: string, payload: DiceRollPayload): void {
  try {
    RoomManager.broadcastToRoom(campaignId, "DICE_RESULT", {
      roller_id: payload.character_id || payload.roller_name,
      roller_name: payload.roller_name,
      dice_type: payload.dice_type,
      raw: payload.raw,
      modifier: payload.modifier,
      final: payload.final,
      context: payload.context,
      roll_breakdown: payload.roll_breakdown,
    });
  } catch (err) {
    console.error("[diceEngine] broadcastDiceRoll failed:", err);
  }
}

// ============================================================
// LEGACY API (combatEngine, soloEngine, eventHandlers)
// ============================================================

export interface RollResult {
  raw: number;
  final: number;
  diceSize: number;
  rolls?: number[];
}

export function rollDice(diceType: string | DiceType, modifier = 0): RollResult {
  const sizeMatch = String(diceType).match(/^d(\d+)$/);
  const diceSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 20;
  const raw = rollDie(diceSize);
  return { raw, final: raw + modifier, diceSize };
}

export function rollWithAdvantage(diceType: string | DiceType = "d20", modifier = 0): RollResult {
  const adv = rollD20WithAdvantagePair();
  return {
    raw: adv.result,
    final: adv.result + modifier,
    diceSize: 20,
    rolls: adv.rolls,
  };
}

export function rollWithDisadvantage(diceType: string | DiceType = "d20", modifier = 0): RollResult {
  const dis = rollD20WithDisadvantagePair();
  return {
    raw: dis.result,
    final: dis.result + modifier,
    diceSize: 20,
    rolls: dis.rolls,
  };
}
