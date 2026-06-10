import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"
import { HpBar } from "@/components/game/HpBar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
  Compass, 
  MapPin, 
  MessageSquare, 
  Send, 
  Users, 
  Dice2,
  Skull,
  UserCheck,
  Sparkles,
  HelpCircle
} from "lucide-react"
import { cn } from "@/lib/utils"

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const {
    activeRole,
    partyCharacters,
    myCharacter,
    eventLogs,
    locations,
    currentLocation,
    currentLocationNpcs,
    handleTravel,
    sendChat,
    rollDice,
    bountyReputations,
    factions
  } = useCampaign()

  const [chatInput, setChatInput] = useState("")
  const [quickDiceMod, setQuickDiceMod] = useState(0)

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    sendChat(chatInput)
    setChatInput("")
  }

  // Parse location state laws & tax
  const locState = currentLocation?.state 
    ? (typeof currentLocation.state === "string" ? JSON.parse(currentLocation.state) : currentLocation.state) 
    : {}
  
  const lawLabel = locState.law ? locState.law.replace(/_/g, " ").toUpperCase() : "ANARCHY"
  const taxLabel = locState.tax_percent !== undefined ? `${locState.tax_percent}%` : "0%"
  const patrolLabel = locState.patrol_level ? locState.patrol_level.toUpperCase() : "NONE"

  // Get connected locations info
  const connectedLocs = currentLocation?.connected_locations
    ? locations.filter((l) => currentLocation.connected_locations.includes(l.id))
    : []

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto game-animate-fade-in">

      {/* ── New Player Nudge: show when player has no character yet ── */}
      {activeRole === "player" && !myCharacter && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border border-[var(--runic-gold)] bg-amber-950/15 rounded-lg shadow-md">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[var(--runic-gold)] animate-pulse shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-[var(--runic-gold)] uppercase tracking-wider block">
                You haven't created your adventurer yet!
              </span>
              <span className="text-zinc-300">
                Head to the Character Sheet to forge your hero — choose a race, class, and name.
              </span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate("../tutorial")} className="text-xs cursor-pointer">
              <HelpCircle className="h-3.5 w-3.5 mr-1.5" />
              How to Play
            </Button>
            <Button size="sm" onClick={() => navigate("../character")} className="text-xs cursor-pointer">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Create Character →
            </Button>
          </div>
        </div>
      )}
      {/* Bounty Alerts Banner */}
      {bountyReputations.map((rep) => {
        const faction = factions.find((f) => f.id === rep.faction_id)
        const isFactionHidden = faction?.is_hidden && activeRole !== "dm"
        const factionName = faction && !isFactionHidden ? faction.name : "Unknown Faction"
        const isHunted = rep.tier === "hunted"

        return (
          <div 
            key={rep.id} 
            className={cn(
              "flex items-center gap-3 px-4 py-3 border rounded-lg shadow-md animate-pulse",
              isHunted 
                ? "bg-red-950/80 border-red-500 text-red-100" 
                : "bg-amber-950/85 border-amber-500 text-amber-100"
            )}
          >
            <Skull className="h-5 w-5 shrink-0" />
            <div className="flex-1 text-xs">
              <span className="font-bold uppercase tracking-wider block">
                🚨 Bounty Active: {rep.tier}
              </span>
              <span>
                You are {rep.tier} by the Faction <strong>{factionName}</strong>. Reputation Score: {rep.score}.
                {isHunted && " Assassin units are tracking you down."}
              </span>
            </div>
          </div>
        )
      })}

      {/* Grid Layout: Hub & Party / Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column (8/12) - Exploration / Locations */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Current Location HUD */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)]">
            <CardHeader className="border-b border-[var(--game-border)]/50 pb-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-[var(--runic-gold)]" />
                  <CardTitle className="text-xl">{currentLocation?.name || "The Wildlands"}</CardTitle>
                </div>
                {currentLocation?.type && (
                  <Badge variant="outline" className="uppercase font-mono tracking-wider border-[var(--runic-gold)]/40 text-[var(--runic-gold)]">
                    {currentLocation.type}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-zinc-400">
                {currentLocation?.description || "A treacherous and uncharted region where danger lurks behind every shadow."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              
              {/* Regional Law / Details */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-3 rounded-md bg-[var(--obsidian)] border border-[var(--game-border)]/30 text-xs font-mono">
                <div>
                  <span className="text-[var(--muted-text)] block">Laws</span>
                  <strong className="text-[var(--parchment)]">{lawLabel}</strong>
                </div>
                <div>
                  <span className="text-[var(--muted-text)] block">Taxation</span>
                  <strong className="text-[var(--parchment)]">{taxLabel}</strong>
                </div>
                <div>
                  <span className="text-[var(--muted-text)] block">Patrol Level</span>
                  <strong className="text-[var(--parchment)]">{patrolLabel}</strong>
                </div>
              </div>

              {/* Local NPCs list */}
              <div>
                <h4 className="text-xs font-mono uppercase tracking-widest text-[var(--runic-gold)] mb-3 flex items-center gap-1.5">
                  <UserCheck className="h-3.5 w-3.5" /> Present Characters & NPCs
                </h4>
                {currentLocationNpcs.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No notable individuals reside here currently.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentLocationNpcs.map((npc) => (
                      <div key={npc.id} className="p-3 border border-[var(--game-border)]/20 rounded-md bg-[var(--game-muted)]/30 flex justify-between items-center text-xs">
                        <div>
                          <strong className="text-[var(--parchment)] block">{npc.name}</strong>
                          <span className="text-[var(--muted-text)]">{npc.role || "Citizen"}</span>
                        </div>
                        {npc.relationship_score !== undefined && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            Rep: {npc.relationship_score}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Travel / Connections */}
              <div className="pt-4 border-t border-[var(--game-border)]/50">
                <h4 className="text-xs font-mono uppercase tracking-widest text-[var(--runic-gold)] mb-3 flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5" /> Travel connections
                </h4>
                {connectedLocs.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No known routes depart from this location.</p>
                ) : (
                  <div className="flex flex-wrap gap-2.5">
                    {connectedLocs.map((loc) => (
                      <Button
                        key={loc.id}
                        variant="outline"
                        size="sm"
                        onClick={() => handleTravel(loc.id)}
                        className="hover:border-[var(--runic-gold)] text-xs border-[var(--game-border)] hover:bg-[var(--game-muted)] cursor-pointer"
                      >
                        Travel to {loc.name}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

            </CardContent>
          </Card>

          {/* Quick Dice Roll Card */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                <Dice2 className="h-4 w-4" /> Quick Dice roller
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 items-center">
                <span className="text-xs font-mono text-[var(--muted-text)]">Modifier:</span>
                <Input
                  type="number"
                  value={quickDiceMod}
                  onChange={(e) => setQuickDiceMod(Number(e.target.value))}
                  className="w-16 h-8 text-xs text-center font-mono border-[var(--game-border)]"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {(["d4", "d6", "d8", "d10", "d12", "d20", "d100"] as const).map((die) => (
                  <Button
                    key={die}
                    variant="secondary"
                    size="sm"
                    onClick={() => rollDice(die, quickDiceMod)}
                    className="font-mono text-xs uppercase cursor-pointer"
                  >
                    {die}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

        </div>

        {/* Right Column (4/12) - Party & Chat Logs */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Party Members Card */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                <Users className="h-4 w-4" /> Active Party
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {partyCharacters.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">No players are currently in the campaign party.</p>
              ) : (
                partyCharacters.map((char) => {
                  const isMe = char.user_id === myCharacter?.user_id
                  return (
                    <div 
                      key={char.id} 
                      className={cn(
                        "p-3 rounded-md border text-xs space-y-2",
                        isMe 
                          ? "border-[var(--runic-gold)] bg-[var(--game-muted)]/40 shadow-sm shadow-black"
                          : "border-[var(--game-border)]/50 bg-[var(--game-card)]/50"
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-[var(--parchment)]">{char.name}</span>
                          <span className="text-[var(--muted-text)] block text-[10px] uppercase font-mono tracking-wider">
                            {char.race} {char.class}
                          </span>
                        </div>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          Lv. {char.level}
                        </Badge>
                      </div>
                      <HpBar current={char.hp_current} max={char.hp_max} showText={true} />
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Chat / Narrative Log */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] flex flex-col h-[400px]">
            <CardHeader className="pb-2 border-b border-[var(--game-border)]/50 shrink-0">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                <MessageSquare className="h-4 w-4" /> Narrative log
              </CardTitle>
            </CardHeader>
            
            {/* Messages Feed */}
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {eventLogs.length === 0 ? (
                <p className="text-xs text-zinc-500 italic text-center pt-8">The chronicle is empty...</p>
              ) : (
                eventLogs.map((evt, idx) => {
                  const isSystem = evt.type === "system"
                  return (
                    <div key={evt.id || idx} className="text-xs leading-relaxed border-b border-zinc-900 pb-2">
                      <span className="text-[10px] text-[var(--muted-text)] font-mono block">
                        {new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isSystem ? (
                        <span className="text-[var(--runic-gold)] italic font-serif">
                          {evt.payload.text}
                        </span>
                      ) : (
                        <p className="text-[var(--parchment)]">
                          <strong className="text-[var(--muted-text)] font-sans">
                            {evt.actor_name || "Adventurer"}:{" "}
                          </strong>
                          {evt.payload.text}
                        </p>
                      )}
                      {evt.ai_narration && (
                        <p className="mt-1 p-2 bg-[var(--obsidian)] border border-[var(--game-border)]/20 rounded font-serif text-amber-200/90 leading-relaxed italic text-[11px]">
                          {evt.ai_narration}
                        </p>
                      )}
                    </div>
                  )
                })
              )}
            </CardContent>

            {/* Input Form */}
            <form onSubmit={handleSendChat} className="p-3 border-t border-[var(--game-border)]/50 flex gap-2 shrink-0 bg-[var(--game-card)]">
              <Input
                placeholder="Speak, traveler..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-grow h-9 text-xs border-[var(--game-border)] bg-[var(--obsidian)]"
              />
              <Button type="submit" size="icon" className="h-9 w-9 shrink-0 cursor-pointer">
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </Card>

        </div>
      </div>
    </div>
  )
}
export default DashboardPage;
