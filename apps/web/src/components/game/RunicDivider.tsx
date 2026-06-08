import React from "react"
import { cn } from "@/lib/utils"

interface RunicDividerProps {
  className?: string;
  glow?: boolean;
}

export const RunicDivider: React.FC<RunicDividerProps> = ({ className, glow = false }) => {
  return (
    <div className={cn("relative flex items-center justify-center py-4 w-full select-none", className)}>
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-[var(--game-border)] opacity-60" />
      </div>
      
      {/* Runic Sigil Centerpiece */}
      <div 
        className={cn(
          "relative z-10 px-4 bg-[var(--obsidian)] border border-[var(--game-border)] rounded-full text-[10px] font-mono text-[var(--runic-gold)] tracking-widest uppercase py-1 shadow-sm",
          glow && "shadow-[0_0_8px_rgba(212,175,55,0.3)] animate-pulse"
        )}
      >
        ᛟ ᚱ ᛞ ᚨ ᛚ
      </div>
    </div>
  )
}
export default RunicDivider;
