import React from "react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface HpBarProps {
  current: number;
  max: number;
  showText?: boolean;
  className?: string;
}

export const HpBar: React.FC<HpBarProps> = ({ current, max, showText = true, className }) => {
  const percentage = Math.max(0, Math.min(100, max > 0 ? (current / max) * 100 : 0));
  const isLow = percentage < 25;

  return (
    <div className={cn("space-y-1 w-full", className)}>
      {showText && (
        <div className="flex justify-between text-xs font-medium">
          <span className="text-[var(--muted-text)] font-semibold uppercase tracking-wider text-[10px]">Hit Points</span>
          <span className={cn("font-mono", isLow ? "text-[var(--blood-ember)] animate-pulse font-bold" : "text-[var(--parchment)]")}>
            {current} / {max}
          </span>
        </div>
      )}
      <Progress
        value={percentage}
        className={cn(
          "h-2.5 border border-[var(--game-border)]",
          isLow && "animate-pulse"
        )}
        indicatorClassName={cn(
          "transition-all duration-300",
          isLow ? "bg-[var(--deep-crimson)]" : percentage < 50 ? "bg-amber-600" : "bg-[var(--blood-ember)]"
        )}
      />
    </div>
  )
}
