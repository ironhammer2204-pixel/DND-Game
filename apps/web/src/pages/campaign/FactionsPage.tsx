import React from "react"
import { useNavigate } from "react-router-dom"
import { FactionControlRoom } from "@/components/FactionControlRoom"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export const FactionsPage: React.FC = () => {
  const navigate = useNavigate()

  const handleClose = () => {
    navigate("../dashboard")
  }

  return (
    <div className="w-full h-full relative game-animate-fade-in">
      {/* Back Button */}
      <div className="flex items-center gap-2 p-4 border-b border-[var(--game-border)]">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-8 w-8 shrink-0 text-[var(--muted-text)] hover:text-[var(--parchment)] cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-[var(--muted-text)] font-mono uppercase tracking-wider">Faction Control Room</span>
      </div>
      {/* We render the FactionControlRoom directly and hook up the onClose to return to Dashboard */}
      <FactionControlRoom onClose={handleClose} />
    </div>
  )
}
export default FactionsPage;

