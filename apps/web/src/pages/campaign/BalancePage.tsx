import React from "react"
import { useCampaign } from "@/context/CampaignContext"
import { useAuthStore } from "@/stores/authStore"
import { BalanceDashboard } from "@/components/BalanceDashboard"
import { Card } from "@/components/ui/card"

export const BalancePage: React.FC = () => {
  const { activeCampaign } = useCampaign()
  const { token } = useAuthStore()

  return (
    <div className="w-full h-full p-6 max-w-7xl mx-auto game-animate-fade-in space-y-6">
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
