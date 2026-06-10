import React from "react"
import { useNavigate } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"
import { useAuthStore } from "@/stores/authStore"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  Settings, 
  LogOut, 
  CornerUpLeft, 
  Copy, 
  Check, 
  UserCircle,
  ArrowLeft
} from "lucide-react"
import { cn } from "@/lib/utils"

export const MenuPage: React.FC = () => {
  const navigate = useNavigate()
  const {
    activeCampaign,
    activeRole,
    handleCopyInvite,
    copyToast
  } = useCampaign()

  const { user, clearSession } = useAuthStore()
  const { setActiveCampaign } = useCampaign()

  const handleReturnToLobby = () => {
    // Return to the general game dashboard or lobby screen
    setActiveCampaign(null, null)
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6 game-animate-fade-in">
      
      {/* Title */}
      <div className="flex items-center gap-3 border-b border-[var(--game-border)] pb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("../dashboard")}
          className="h-8 w-8 shrink-0 text-[var(--muted-text)] hover:text-[var(--parchment)] cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Settings className="h-6 w-6 text-[var(--runic-gold)]" />
        <div>
          <h2 className="text-xl font-serif font-bold text-[var(--parchment)]">
            CAMPAIGN MENU
          </h2>
          <p className="text-xs text-[var(--muted-text)] font-mono">
            Manage your session, copy invite credentials, and configure account access.
          </p>
        </div>
      </div>

      {/* Session details */}
      <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
        <CardHeader className="pb-3 border-b border-[var(--game-border)]/50">
          <CardTitle className="text-sm font-serif">Lobby & Invite Info</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex justify-between items-center bg-[var(--obsidian)]/30 p-3 rounded-md border border-[var(--game-border)]/15">
            <div>
              <span className="text-[10px] uppercase font-mono text-[var(--muted-text)] block">Active Session</span>
              <strong className="text-sm font-serif text-[var(--runic-gold)]">{activeCampaign?.name}</strong>
            </div>
            <Badge variant="outline" className={cn(
              "uppercase font-mono text-[10px] tracking-wider",
              activeRole === "dm" ? "border-[var(--runic-gold)] text-[var(--runic-gold)]" : "border-blue-500/50 text-blue-400"
            )}>
              {activeRole === "dm" ? "Dungeon Master" : "Player"}
            </Badge>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-mono text-[var(--muted-text)] block">Invite Code</span>
            <div className="flex gap-2">
              <code className="flex-1 h-10 px-3 flex items-center bg-[var(--obsidian)] border border-[var(--game-border)]/30 rounded text-sm text-[var(--runic-gold)] font-mono">
                {activeCampaign?.invite_code}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyInvite}
                className="h-10 w-10 border-[var(--game-border)] hover:bg-[var(--game-muted)] cursor-pointer"
                title="Copy Invite Code"
              >
                {copyToast === "success" ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4 text-[var(--parchment)]" />
                )}
              </Button>
            </div>
            {copyToast === "success" && (
              <span className="text-[10px] font-mono text-emerald-400 block mt-0.5">
                Invite code copied to clipboard!
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Account Info */}
      <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
        <CardHeader className="pb-3 border-b border-[var(--game-border)]/50">
          <CardTitle className="text-sm font-serif">Adventurer Account</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 border border-[var(--game-border)]/30 bg-[var(--obsidian)]/20 rounded-full">
              <UserCircle className="h-6 w-6 text-[var(--muted-text)]" />
            </div>
            <div>
              <strong className="text-sm text-[var(--parchment)] block">{user?.username}</strong>
              <span className="text-xs text-[var(--muted-text)] font-mono">{user?.email}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="space-y-2 pt-2">
        <Button 
          variant="outline" 
          onClick={handleReturnToLobby}
          className="w-full h-11 border-[var(--game-border)] hover:bg-[var(--game-muted)] cursor-pointer"
        >
          <CornerUpLeft className="h-4.5 w-4.5 mr-2" /> Return to Lobby Screen
        </Button>
        <Button 
          variant="destructive" 
          onClick={clearSession}
          className="w-full h-11 cursor-pointer"
        >
          <LogOut className="h-4.5 w-4.5 mr-2" /> Log Out Account
        </Button>
      </div>

    </div>
  )
}
export default MenuPage;
