import { useState } from "react";
import type { DiceType } from "@dnd/shared";

interface DicePanelProps {
  onRoll: (dice: DiceType, modifier: number) => void;
  disabled?: boolean;
}

const DICE: DiceType[] = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

export function DicePanel({ onRoll, disabled = false }: DicePanelProps) {
  const [modifier, setModifier] = useState(0);
  const [rollingDice, setRollingDice] = useState<DiceType | null>(null);

  const handleRoll = (dice: DiceType) => {
    if (disabled) return;
    setRollingDice(dice);
    onRoll(dice, modifier);
    setTimeout(() => setRollingDice(null), 600);
  };

  return (
    <div className="dice-panel">
      <div className="dice-panel__modifier-row">
        <button
          type="button"
          className="btn dice-panel__mod-btn"
          onClick={() => setModifier((m) => m - 1)}
          disabled={disabled}
          aria-label="Decrease modifier"
        >
          &minus;
        </button>
        <div className="dice-panel__mod-display">
          <span className="dice-panel__mod-label">MOD</span>
          <span className="dice-panel__mod-value">
            {modifier >= 0 ? `+${modifier}` : modifier}
          </span>
        </div>
        <button
          type="button"
          className="btn dice-panel__mod-btn"
          onClick={() => setModifier((m) => m + 1)}
          disabled={disabled}
          aria-label="Increase modifier"
        >
          +
        </button>
        <button
          type="button"
          className="btn dice-panel__reset-btn"
          onClick={() => setModifier(0)}
          disabled={disabled || modifier === 0}
          aria-label="Reset modifier"
        >
          Reset
        </button>
      </div>

      <div className="dice-panel__grid">
        {DICE.map((dice) => (
          <button
            key={dice}
            type="button"
            className={`dice-btn${rollingDice === dice ? " dice-btn--rolling" : ""}${dice === "d100" ? " dice-btn--wide" : ""}`}
            onClick={() => handleRoll(dice)}
            disabled={disabled}
            aria-label={`Roll ${dice}`}
          >
            <span className="dice-btn__face">{dice.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
