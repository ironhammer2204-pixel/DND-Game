import React from "react"
import { useNavigate } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"
import { useAuthStore } from "@/stores/authStore"
import { BalanceDashboard } from "@/components/BalanceDashboard"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export const BalancePage: React.FC = () => {
  const navigate = useNavigate()
  const { activeCampaign } = useCampaign()
  const { token } = useAuthStore()

  return (
    <div className="w-full h-full p-6 max-w-7xl mx-auto game-animate-fade-in space-y-6">
      {/* Back Button */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("../dashboard")}
          className="h-8 w-8 shrink-0 text-[var(--muted-text)] hover:text-[var(--parchment)] cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-[var(--muted-text)] font-mono uppercase tracking-wider">Balance Dashboard</span>
      </div>
      <Card className="border-[var(--game-border)] bg-[var(--game-card)] p-4 shadow-lg">
        {activeCampaign && token && (
          <BalanceDashboard 
            campaignId={activeCampaign.id} 
            token={token} 
          />
        )}
      </Card>
    </div>
  )
}
export default BalancePage;
