import React from "react"
import { useCampaign } from "@/context/CampaignContext"
import { WifiOff, RefreshCw, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export const StaleDataBanner: React.FC = () => {
  const { wsStatus } = useCampaign()

  if (wsStatus === "connected") return null

  const isConnecting = wsStatus === "connecting"

  return (
    <div 
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono border-b transition-all duration-300 select-none",
        isConnecting 
          ? "bg-amber-950/70 border-amber-500/30 text-amber-300" 
          : "bg-red-950/70 border-red-500/30 text-red-300"
      )}
      role="status"
      aria-live="polite"
    >
      {isConnecting ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <WifiOff className="h-3.5 w-3.5" />
      )}
      <span>
        {isConnecting 
          ? "Connecting to server... (this may take up to 30 seconds on cold start)" 
          : "Connection lost. Displaying cached game state. Attempting to reconnect..."}
      </span>
      <AlertTriangle className="h-3.5 w-3.5 opacity-80" />
    </div>
  )
}
export default StaleDataBanner;
