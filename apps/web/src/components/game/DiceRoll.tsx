import React, { useEffect } from "react"
import { useCampaign } from "@/context/CampaignContext"
import { Dices, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const DiceRoll: React.FC = () => {
  const { activeRoll, dismissActiveRoll } = useCampaign()

  useEffect(() => {
    if (!activeRoll) return;
    const timer = setTimeout(() => dismissActiveRoll(), 8000);
    return () => clearTimeout(timer);
  }, [activeRoll, dismissActiveRoll]);

  if (!activeRoll) return null

  const isD20 = activeRoll.dice_type === "d20"
  const isCritSuccess = isD20 && activeRoll.raw === 20
  const isCritFail = isD20 && activeRoll.raw === 1

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm w-80 game-animate-slide-up">
      <div 
        className={cn(
          "relative border-2 bg-zinc-950/90 backdrop-blur-md p-5 rounded-lg shadow-2xl overflow-hidden",
          isCritSuccess 
            ? "border-[var(--runic-gold)] shadow-[0_0_20px_rgba(212,175,55,0.4)]"
            : isCritFail 
              ? "border-[var(--deep-crimson)] shadow-[0_0_20px_rgba(139,0,0,0.4)]"
              : "border-[var(--game-border)] shadow-black"
        )}
      >
        {/* Critical Hit / Fail Glow Backgrounds */}
        {isCritSuccess && (
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/10 to-amber-500/10 pointer-events-none" />
        )}
        {isCritFail && (
          <div className="absolute inset-0 bg-gradient-to-r from-red-600/10 to-rose-600/10 pointer-events-none" />
        )}

        {/* Close Button */}
        <Button
          size="icon"
          variant="ghost"
          onClick={dismissActiveRoll}
          className="absolute top-2 right-2 h-6 w-6 text-[var(--muted-text)] hover:text-[var(--parchment)]"
        >
          <X className="h-3.5 w-3.5" />
        </Button>

        <div className="flex items-start gap-4">
          <div 
            className={cn(
              "p-2.5 rounded-md border",
              isCritSuccess 
                ? "bg-amber-950/40 text-[var(--runic-gold)] border-[var(--runic-gold)]"
                : isCritFail 
                  ? "bg-red-950/40 text-[var(--blood-ember)] border-[var(--deep-crimson)]"
                  : "bg-[var(--game-muted)] text-[var(--runic-gold)] border-[var(--game-border)]"
            )}
          >
            <Dices className="h-6 w-6" />
          </div>

          <div className="flex-1 space-y-1">
            <p className="text-[10px] text-[var(--muted-text)] font-mono tracking-widest uppercase">
              {activeRoll.context || "Dice Roll"}
            </p>
            <h4 className="text-sm font-semibold text-[var(--parchment)] font-serif leading-tight">
              {activeRoll.roller_name}
            </h4>

            {/* Calculations Breakdown */}
            <div className="flex items-baseline gap-2 mt-1 flex-wrap">
              <span className="text-3xl font-bold font-mono text-[var(--parchment)] tracking-tight">
                {activeRoll.final}
              </span>
              <span className="text-xs text-[var(--muted-text)] font-mono">
                ({activeRoll.raw} + {activeRoll.modifier})
              </span>
              {activeRoll.roll_breakdown?.dc !== undefined && (
                <span className="text-xs text-gray-500 ml-1">DC {activeRoll.roll_breakdown.dc}</span>
              )}
              {activeRoll.roll_breakdown?.success !== undefined && (
                <span className={`text-xs font-bold ml-1 ${activeRoll.roll_breakdown.success ? "text-green-400" : "text-red-400"}`}>
                  {activeRoll.roll_breakdown.success ? "SUCCESS" : "FAILURE"}
                </span>
              )}
            </div>

            {activeRoll.roll_breakdown?.raw_rolls && activeRoll.roll_breakdown.raw_rolls.length > 1 && (
              <div className="text-xs text-gray-500 mt-1 font-mono">
                Rolls: {activeRoll.roll_breakdown.raw_rolls.join(", ")}
              </div>
            )}

            {/* Runic Formula Type */}
            <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono text-[var(--runic-gold)] uppercase tracking-wider">
              <span>Formula:</span>
              <span className="border border-[var(--runic-gold)]/30 px-1 py-0.2 rounded bg-[var(--obsidian)]">
                {activeRoll.dice_type}
              </span>
              {isCritSuccess && (
                <span className="text-amber-400 font-bold ml-1 animate-pulse">
                  CRITICAL!
                </span>
              )}
              {isCritFail && (
                <span className="text-red-500 font-bold ml-1 animate-pulse">
                  FUMBLE!
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
