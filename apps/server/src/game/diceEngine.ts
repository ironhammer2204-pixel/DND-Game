import { randomInt } from "crypto";
import { DiceType } from "@dnd/shared";

export interface RollResult {
  raw: number;
  final: number;
  diceSize: number;
  rolls?: number[]; // To show both rolls for advantage/disadvantage
}

/**
 * Roll a die of the specified type with a modifier, using cryptographically secure random numbers.
 * @param diceType e.g., 'd20'
 * @param modifier e.g., 2 or -1
 */
export function rollDice(diceType: string | DiceType, modifier = 0): RollResult {
  const sizeMatch = diceType.match(/^d(\d+)$/);
  const diceSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 20;

  // randomInt(min, max) returns a value in [min, max)
  const raw = randomInt(1, diceSize + 1);
  const final = raw + modifier;

  return {
    raw,
    final,
    diceSize,
  };
}

/**
 * Roll two d20 dice and take the higher value.
 */
export function rollWithAdvantage(diceType: string | DiceType = "d20", modifier = 0): RollResult {
  const roll1 = rollDice(diceType, 0);
  const roll2 = rollDice(diceType, 0);
  const raw = Math.max(roll1.raw, roll2.raw);
  return {
    raw,
    final: raw + modifier,
    diceSize: roll1.diceSize,
    rolls: [roll1.raw, roll2.raw],
  };
}

/**
 * Roll two d20 dice and take the lower value.
 */
export function rollWithDisadvantage(diceType: string | DiceType = "d20", modifier = 0): RollResult {
  const roll1 = rollDice(diceType, 0);
  const roll2 = rollDice(diceType, 0);
  const raw = Math.min(roll1.raw, roll2.raw);
  return {
    raw,
    final: raw + modifier,
    diceSize: roll1.diceSize,
    rolls: [roll1.raw, roll2.raw],
  };
}
