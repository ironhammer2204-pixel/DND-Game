import { randomInt } from "crypto";
import { DiceType } from "@dnd/shared";

export interface RollResult {
  raw: number;
  final: number;
  diceSize: number;
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
  // To get [1, diceSize], we use randomInt(1, diceSize + 1)
  const raw = randomInt(1, diceSize + 1);
  const final = raw + modifier;

  return {
    raw,
    final,
    diceSize,
  };
}
