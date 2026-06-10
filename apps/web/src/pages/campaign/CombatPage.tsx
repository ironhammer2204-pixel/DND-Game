import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"
import { ConditionChip } from "@/components/game/ConditionChip"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { 
  Swords, 
  ShieldAlert, 
  Timer, 
  Play, 
  Skull,
  ArrowLeft
} from "lucide-react"
import { cn } from "@/lib/utils"

export const CombatPage: React.FC = () => {
  const navigate = useNavigate()
  const {
    activeCombat,
    activeRole,
    myCharacter,
    ws,
    wsStatus,
    handleToggleCondition
  } = useCampaign()

  // DM setup state
  const [selectedMonster, setSelectedMonster] = useState("goblin")
  const [monsterCount, setMonsterCount] = useState(1)

  // Player action state
  const [selectedTarget, setSelectedTarget] = useState("")

  const handleStartCombat = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ws) return
    ws.send(
      JSON.stringify({
        type: "START_COMBAT",
        payload: { monsters: [{ id: selectedMonster, count: monsterCount }] },
      })
    )
  }

  const handleCombatAction = (actionType: "attack" | "dodge" | "use_item" | "end_turn", targetId?: string) => {
    if (!ws) return
    ws.send(
      JSON.stringify({
        type: "COMBAT_ACTION",
        payload: { action_type: actionType, target_id: targetId },
      })
    )
  }

  const handleRollDeathSave = () => {
    if (!ws) return
    ws.send(JSON.stringify({ type: "DEATH_SAVE_ROLL", payload: {} }))
  }

  // Render setup view if no combat active
  if (!activeCombat) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-6 game-animate-fade-in">
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
          <span className="text-xs text-[var(--muted-text)] font-mono uppercase tracking-wider">Combat Arena</span>
        </div>
        <Card className="border-[var(--game-border)] bg-[var(--game-card)]">
          <CardHeader className="text-center pb-4 border-b border-[var(--game-border)]/50">
            <div className="mx-auto w-12 h-12 rounded-full border border-[var(--game-border)] flex items-center justify-center bg-[var(--obsidian)] mb-3">
              <Swords className="h-6 w-6 text-[var(--runic-gold)]" />
            </div>
            <CardTitle className="text-xl">Combat Arena</CardTitle>
            <CardDescription className="text-zinc-400">
              The environment is calm. No active hostilities are underway.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {activeRole === "dm" ? (
              <form onSubmit={handleStartCombat} className="space-y-4">
                <h3 className="text-sm font-mono uppercase tracking-widest text-[var(--runic-gold)] mb-3">
                  Initiate Hostilities
                </h3>
                <div className="space-y-2">
                  <label htmlFor="monster-select" className="text-xs font-mono text-[var(--muted-text)] block">
                    Choose Opponents
                  </label>
                  <select
                    id="monster-select"
                    value={selectedMonster}
                    onChange={(e) => setSelectedMonster(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-[var(--game-border)] bg-[var(--obsidian)] text-xs text-[var(--parchment)]"
                  >
                    <option value="goblin">Goblin (CR 1/4)</option>
                    <option value="kobold">Kobold (CR 1/8)</option>
                    <option value="orc">Orc (CR 1/2)</option>
                    <option value="skeleton">Skeleton (CR 1/4)</option>
                    <option value="red_dragon">Red Dragon Wyrmling (CR 4)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="monster-count" className="text-xs font-mono text-[var(--muted-text)] block">
                    Opponent Quantity (1-5)
                  </label>
                  <input
                    id="monster-count"
                    type="number"
                    min={1}
                    max={5}
                    value={monsterCount}
                    onChange={(e) => setMonsterCount(parseInt(e.target.value) || 1)}
                    className="w-full h-10 px-3 rounded-md border border-[var(--game-border)] bg-[var(--obsidian)] text-xs text-[var(--parchment)] font-mono"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={wsStatus !== "connected"}
                  className="w-full mt-4 cursor-pointer"
                >
                  <Play className="h-4 w-4 mr-2" /> Summon Foes & Roll Initiative
                </Button>
              </form>
            ) : (
              <div className="text-center py-6 text-zinc-500 text-xs italic font-serif">
                Waiting for the Dungeon Master to declare an encounter...
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // Active combat variables
  const activeParticipant = activeCombat.turn_order[activeCombat.current_turn_index]
  const isMyTurn = myCharacter && activeParticipant?.id === myCharacter.id
  const isEnemyTurn = activeParticipant?.type === "enemy"
  const isDowned = myCharacter && myCharacter.hp_current === 0 && !activeParticipant?.conditions?.includes("stable")

  const enemies = activeCombat.turn_order.filter((p) => p.type === "enemy" && p.hp_current > 0)
  const currentTargetId = selectedTarget && enemies.some((e) => e.id === selectedTarget)
    ? selectedTarget
    : (enemies[0]?.id || "")

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto game-animate-fade-in">
      
      {/* Back Button */}
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("../dashboard")}
          className="h-8 w-8 shrink-0 text-[var(--muted-text)] hover:text-[var(--parchment)] cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-[var(--muted-text)] font-mono uppercase tracking-wider">← Dashboard</span>
      </div>
      
      {/* Combat status header */}
      <div className="flex flex-wrap justify-between items-center gap-4 bg-[var(--game-card)] border border-[var(--game-border)] p-4 rounded-lg shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full border border-[var(--game-border)] bg-[var(--obsidian)] animate-pulse">
            <Swords className="h-5 w-5 text-[var(--blood-ember)]" />
          </div>
          <div>
            <h2 className="text-md font-serif font-bold text-[var(--runic-gold)]">
              ACTIVE ENCOUNTER
            </h2>
            <span className="text-[10px] font-mono text-[var(--muted-text)] uppercase tracking-wider block">
              Round: {activeCombat.round_number} &middot; Turn Index: {activeCombat.current_turn_index + 1}
            </span>
          </div>
        </div>
        <div className="text-xs text-right">
          <span className="text-[var(--muted-text)] block font-mono">CURRENT TURN</span>
          <strong className="text-[var(--runic-gold)] font-serif text-sm">
            {activeParticipant ? activeParticipant.name : "Unknown creature"}
          </strong>
        </div>
      </div>

      {/* Grid: Turn list (8/12) & Action console (4/12) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Turn order list */}
        <div className="md:col-span-8 space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-widest text-[var(--runic-gold)] flex items-center gap-1.5">
            <Timer className="h-4 w-4" /> Combatants Initiative
          </h3>

          <div className="space-y-3">
            {activeCombat.turn_order.map((p, idx) => {
              const isCurrent = idx === activeCombat.current_turn_index
              const hpPct = Math.max(0, (p.hp_current / p.hp_max) * 100)
              const isDead = p.hp_current <= 0
              const isUnconscious = isDead && p.type === "player" && !p.conditions.includes("stable")
              const isStable = p.conditions.includes("stable")

              return (
                <div 
                  key={p.id}
                  className={cn(
                    "p-4 border rounded-lg transition-all duration-300 relative overflow-hidden",
                    isCurrent 
                      ? "border-[var(--runic-gold)] bg-amber-950/15 shadow-[0_0_12px_rgba(212,175,55,0.25)]" 
                      : "border-[var(--game-border)]/50 bg-[var(--game-card)]/60",
                    isDead && "opacity-50"
                  )}
                >
                  {/* Current Active Indicator Bar */}
                  {isCurrent && (
                    <div className="absolute top-0 bottom-0 left-0 w-1 bg-[var(--runic-gold)]" />
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    
                    {/* Character Title Info */}
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full border border-[var(--game-border)] flex items-center justify-center bg-[var(--obsidian)] shrink-0 font-bold text-xs text-[var(--muted-text)] font-serif">
                        {p.initiative}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className={cn("text-sm", isCurrent ? "text-[var(--runic-gold)] font-serif" : "text-[var(--parchment)]")}>
                            {p.name}
                          </strong>
                          {p.type === "enemy" ? (
                            <Badge variant="destructive" className="text-[8px] uppercase tracking-wider font-mono px-1.5 py-0.2">Foe</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[8px] uppercase tracking-wider font-mono px-1.5 py-0.2 border-blue-500/50 text-blue-400">Hero</Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--muted-text)] font-mono">
                          AC: {p.ac} &middot; HP: {p.hp_current}/{p.hp_max}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar & Conditions */}
                    <div className="flex-1 max-w-xs space-y-2">
                      <Progress 
                        value={hpPct} 
                        className="h-2 border border-[var(--game-border)]/50 bg-[var(--obsidian)]"
                        indicatorClassName={cn(
                          p.hp_current / p.hp_max > 0.5 
                            ? "bg-emerald-600" 
                            : p.hp_current / p.hp_max > 0.25 
                              ? "bg-amber-600" 
                              : "bg-[var(--deep-crimson)]"
                        )}
                      />

                      {/* Display active conditions & Death Saves */}
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {p.conditions.map((cond) => (
                          <ConditionChip
                            key={cond}
                            participantId={p.id}
                            condition={cond as "poisoned" | "stunned" | "paralysed" | "dodging"}
                            isActive={true}
                            interactive={activeRole === "dm"}
                          />
                        ))}
                        {isUnconscious && (
                          <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--deep-crimson)]">
                            <Skull className="h-3 w-3" />
                            Saves: ✓ {p.death_save_successes} &middot; ✗ {p.death_save_failures}
                          </span>
                        )}
                        {isStable && (
                          <span className="text-[10px] font-mono text-emerald-400">Stable</span>
                        )}
                        {p.conditions.length === 0 && !isUnconscious && !isStable && (
                          <span className="text-[10px] text-zinc-600 italic">No conditions</span>
                        )}
                      </div>
                    </div>

                    {/* DM Condition toggles for all list items */}
                    {activeRole === "dm" && (
                      <div className="flex gap-1 shrink-0">
                        {(["poisoned", "stunned", "paralysed", "dodging"] as const).map((cond) => {
                          const hasCond = p.conditions.includes(cond)
                          return (
                            <Button
                              key={cond}
                              variant={hasCond ? "default" : "outline"}
                              size="sm"
                              onClick={() => handleToggleCondition(p.id, cond, hasCond ? "remove" : "add")}
                              className={cn(
                                "text-[9px] font-mono h-6 px-1.5 uppercase cursor-pointer",
                                hasCond 
                                  ? "bg-[var(--runic-gold)] text-[var(--obsidian)] hover:bg-[var(--runic-gold)]/80"
                                  : "border-[var(--game-border)] text-zinc-500"
                              )}
                            >
                              {cond.substring(0, 3)}
                            </Button>
                          )
                        })}
                      </div>
                    )}

                  </div>
                </div>
              )
            })}
          </div>

        </div>

        {/* Right Column: Console Action UI */}
        <div className="md:col-span-4 space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-widest text-[var(--runic-gold)] flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4" /> Action console
          </h3>

          <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
            <CardHeader className="pb-3 border-b border-[var(--game-border)]/50">
              <CardTitle className="text-sm font-serif">Console Controls</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              
              {isEnemyTurn ? (
                <div className="text-center py-6 space-y-2">
                  <div className="w-6 h-6 border-2 border-[var(--runic-gold)] border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-[var(--muted-text)] font-serif italic">
                    {activeParticipant.name} is formulating a battle action...
                  </p>
                </div>
              ) : isMyTurn ? (
                
                isDowned ? (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-xs text-[var(--deep-crimson)] font-mono uppercase font-bold animate-pulse">
                      ⚠️ Unconscious / Downed!
                    </p>
                    <p className="text-xs text-[var(--muted-text)]">
                      Roll a death saving throw to hold on to your life.
                    </p>
                    <Button 
                      variant="destructive" 
                      onClick={handleRollDeathSave} 
                      className="w-full cursor-pointer"
                    >
                      💀 Roll Death Save
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="combat-target" className="text-xs font-mono text-[var(--muted-text)] block">
                        Select Target
                      </label>
                      <select
                        id="combat-target"
                        value={currentTargetId}
                        onChange={(e) => setSelectedTarget(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-[var(--game-border)] bg-[var(--obsidian)] text-xs text-[var(--parchment)]"
                      >
                        {enemies.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} ({e.hp_current}/{e.hp_max} HP)
                          </option>
                        ))}
                        {enemies.length === 0 && <option value="">No enemies remaining</option>}
                      </select>
                    </div>

                    <div className="space-y-2 pt-2">
                      <Button
                        onClick={() => handleCombatAction("attack", currentTargetId)}
                        disabled={enemies.length === 0}
                        className="w-full cursor-pointer"
                      >
                        ⚔️ Strike Target
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleCombatAction("dodge")}
                          className="text-xs cursor-pointer"
                        >
                          🛡️ Dodge
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleCombatAction("end_turn")}
                          className="text-xs cursor-pointer"
                        >
                          End Turn
                        </Button>
                      </div>
                    </div>
                  </div>
                )

              ) : (
                <div className="text-center py-6 text-zinc-500 text-xs italic font-serif">
                  {activeParticipant 
                    ? `Waiting for ${activeParticipant.name} to complete their turn...` 
                    : "No creatures are taking actions."}
                </div>
              )}

            </CardContent>
          </Card>
        </div>

      </div>

    </div>
  )
}
export default CombatPage;
