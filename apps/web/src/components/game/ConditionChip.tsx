import React from "react"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCampaign } from "@/context/CampaignContext"

type ConditionType = "poisoned" | "stunned" | "paralysed" | "dodging"

interface ConditionChipProps {
  participantId: string;
  condition: ConditionType;
  isActive: boolean;
  interactive?: boolean;
}

const CONDITION_COLORS: Record<ConditionType, { bg: string; text: string; border: string }> = {
  poisoned: {
    bg: "bg-emerald-950/40",
    text: "text-emerald-400",
    border: "border-emerald-700/50",
  },
  stunned: {
    bg: "bg-amber-950/40",
    text: "text-amber-400",
    border: "border-amber-700/50",
  },
  paralysed: {
    bg: "bg-purple-950/40",
    text: "text-purple-400",
    border: "border-purple-700/50",
  },
  dodging: {
    bg: "bg-blue-950/40",
    text: "text-blue-400",
    border: "border-blue-700/50",
  },
}

export const ConditionChip: React.FC<ConditionChipProps> = ({
  participantId,
  condition,
  isActive,
  interactive = false,
}) => {
  const { handleToggleCondition } = useCampaign()

  const colors = CONDITION_COLORS[condition]

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!interactive) return
    handleToggleCondition(participantId, condition, isActive ? "remove" : "add")
  }

  return (
    <Badge
      variant="outline"
      onClick={interactive ? handleClick : undefined}
      className={cn(
        "capitalize select-none font-mono text-[10px] tracking-wider px-2 py-0.5 transition-all duration-200",
        isActive 
          ? `${colors.bg} ${colors.text} ${colors.border} font-semibold shadow-sm shadow-black`
          : "bg-transparent text-[var(--muted-text)] border-zinc-800 hover:border-zinc-700 hover:text-[var(--parchment)]",
        interactive && "cursor-pointer"
      )}
    >
      <span className="flex items-center gap-1">
        {condition}
        {isActive && interactive && (
          <X className="h-2.5 w-2.5 opacity-60 hover:opacity-100" />
        )}
      </span>
    </Badge>
  )
}
