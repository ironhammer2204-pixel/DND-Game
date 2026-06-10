import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"
import { RACES, CLASSES, type Character } from "@dnd/shared"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { 
  User, 
  Sparkles, 
  Coins, 
  Shield, 
  Sword, 
  BookOpen, 
  Trash2, 
  Dices,
  PlusCircle,
  FolderHeart,
  ArrowLeft
} from "lucide-react"
import { cn } from "@/lib/utils"

// Class starting stats lookup for remaining point validations
const CLASS_STARTING_STATS: Record<string, { attributes: Record<string, number>; hp: number }> = {
  Barbarian: { attributes: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 10 }, hp: 14 },
  Bard: { attributes: { str: 8, dex: 14, con: 12, int: 10, wis: 12, cha: 15 }, hp: 9 },
  Cleric: { attributes: { str: 14, dex: 8, con: 12, int: 10, wis: 15, cha: 10 }, hp: 9 },
  Druid: { attributes: { str: 10, dex: 12, con: 13, int: 10, wis: 15, cha: 8 }, hp: 9 },
  Fighter: { attributes: { str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 8 }, hp: 12 },
  Monk: { attributes: { str: 10, dex: 15, con: 12, int: 10, wis: 14, cha: 8 }, hp: 9 },
  Paladin: { attributes: { str: 15, dex: 8, con: 13, int: 10, wis: 12, cha: 14 }, hp: 11 },
  Ranger: { attributes: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 }, hp: 11 },
  Rogue: { attributes: { str: 8, dex: 15, con: 12, int: 13, wis: 10, cha: 14 }, hp: 9 },
  Sorcerer: { attributes: { str: 8, dex: 13, con: 14, int: 10, wis: 10, cha: 15 }, hp: 8 },
  Warlock: { attributes: { str: 8, dex: 13, con: 14, int: 10, wis: 10, cha: 15 }, hp: 10 },
  Wizard: { attributes: { str: 8, dex: 13, con: 14, int: 15, wis: 10, cha: 10 }, hp: 8 },
}

export const CharacterSheetPage: React.FC = () => {
  const navigate = useNavigate()
  const {
    myCharacter,
    inventory,
    reputations,
    factions,
    derivedAc,
    attackBonus,
    spellSaveDc,
    proficiencyBonus,
    wsStatus,
    rollAttribute,
    rollSkill,
    toggleInventoryEquip,
    dropInventoryItem,
    createCharacter,
    handleAllocateStats,
    activeCombat
  } = useCampaign()

  // Creation State
  const [creationName, setCreationName] = useState("")
  const [creationRace, setCreationRace] = useState<string>(RACES[0])
  const [creationClass, setCreationClass] = useState<string>(CLASSES[0])
  const [creationError, setCreationError] = useState("")
  const [isSpawning, setIsSpawning] = useState(false)

  // ASI Allocation State
  const [showAsiDialog, setShowAsiDialog] = useState(false)
  const [tempAttributes, setTempAttributes] = useState<Record<string, number>>({})
  const [allocationError, setAllocationError] = useState("")

  const getAvailableStatPoints = (char: Character) => {
    const defaults = CLASS_STARTING_STATS[char.class]
    if (!defaults) return 0
    const startingSum = Object.values(defaults.attributes).reduce((s, v) => s + v, 0)
    const currentSum = Object.values(char.attributes).reduce((s, v) => s + Number(v), 0)
    const allowed = startingSum + 2 * (char.level - 1)
    return Math.max(0, allowed - currentSum)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreationError("")
    setIsSpawning(true)
    try {
      await createCharacter(creationName, creationRace, creationClass)
      setCreationName("")
    } catch (err) {
      setCreationError(err instanceof Error ? err.message : "Character creation failed.")
    } finally {
      setIsSpawning(false)
    }
  }

  const handleOpenAsi = () => {
    if (!myCharacter) return
    setTempAttributes({ ...myCharacter.attributes })
    setAllocationError("")
    setShowAsiDialog(true)
  }

  const handleSaveAsi = async () => {
    setAllocationError("")
    try {
      await handleAllocateStats(tempAttributes)
      setShowAsiDialog(false)
    } catch (err) {
      setAllocationError(err instanceof Error ? err.message : "Allocation failed")
    }
  }

  // Render character creation panel if player doesn't have an adventurer
  if (!myCharacter) {
    return (
      <div className="p-6 max-w-md mx-auto space-y-6 game-animate-fade-in">
        <Card className="border-[var(--game-border)] bg-[var(--game-card)]">
          <CardHeader className="text-center pb-4 border-b border-[var(--game-border)]/50">
            <div className="mx-auto w-12 h-12 rounded-full border border-[var(--game-border)] flex items-center justify-center bg-[var(--obsidian)] mb-3">
              <User className="h-6 w-6 text-[var(--runic-gold)]" />
            </div>
            <CardTitle className="text-xl">Create Adventurer</CardTitle>
            <CardDescription className="text-zinc-400">
              Forge your hero to embark upon the campaign.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {creationError && (
              <div className="p-3 bg-red-950/40 border border-red-500/50 rounded text-xs text-red-200 mb-4 font-mono">
                {creationError}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="char-name" className="text-xs font-mono text-[var(--muted-text)] block">Character Name</label>
                <Input
                  id="char-name"
                  placeholder="e.g. Thorin Ironhammer"
                  value={creationName}
                  onChange={(e) => setCreationName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="char-race" className="text-xs font-mono text-[var(--muted-text)] block">Race Selection</label>
                <select
                  id="char-race"
                  value={creationRace}
                  onChange={(e) => setCreationRace(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-[var(--game-border)] bg-[var(--obsidian)] text-xs text-[var(--parchment)]"
                >
                  {RACES.map((race) => (
                    <option key={race} value={race}>{race}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="char-class" className="text-xs font-mono text-[var(--muted-text)] block">Class Archetype</label>
                <select
                  id="char-class"
                  value={creationClass}
                  onChange={(e) => setCreationClass(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-[var(--game-border)] bg-[var(--obsidian)] text-xs text-[var(--parchment)]"
                >
                  {CLASSES.map((cls) => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
              </div>

              <Button
                type="submit"
                disabled={isSpawning || wsStatus !== "connected"}
                className="w-full mt-4 cursor-pointer"
              >
                Spawn Adventurer
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Stat block calculations
  const availableAsiPoints = getAvailableStatPoints(myCharacter)
  const displaySpellcasting = CLASS_STARTING_STATS[myCharacter.class] ? spellSaveDc : null

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto game-animate-fade-in">

      {/* Back Button Header */}
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
        <span className="text-xs text-[var(--muted-text)] font-mono uppercase tracking-wider">Character Sheet</span>
      </div>
      
      {/* ASI Points Alert Banner */}
      {availableAsiPoints > 0 && !activeCombat && (
        <div className="flex items-center justify-between gap-4 p-4 border border-[var(--runic-gold)] bg-amber-950/15 rounded-lg shadow-md">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-[var(--runic-gold)] animate-pulse" />
            <div className="text-xs">
              <span className="font-bold text-[var(--runic-gold)] uppercase tracking-wider block">
                Stat Points Available!
              </span>
              <span className="text-zinc-300">
                You have {availableAsiPoints} unused attributes points to allocate to your core statistics.
              </span>
            </div>
          </div>
          <Button 
            variant="default" 
            size="sm" 
            onClick={handleOpenAsi}
            className="text-xs cursor-pointer shrink-0"
          >
            Allocate Points
          </Button>
        </div>
      )}

      {/* Grid: Details / Stats & Attributes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Summary & Inventory (7/12) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* General Character Card */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
            <CardHeader className="border-b border-[var(--game-border)]/50 pb-4">
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <CardTitle className="text-2xl">{myCharacter.name}</CardTitle>
                  <CardDescription className="text-zinc-400 capitalize">
                    Lv. {myCharacter.level} &middot; {myCharacter.race} {myCharacter.class}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono text-xs border-[var(--runic-gold)]/40 text-[var(--runic-gold)]">
                  Prof: +{proficiencyBonus}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              
              {/* Combat Core Statistics */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-center">
                <div className="p-2.5 border border-[var(--game-border)]/30 rounded-md bg-[var(--obsidian)]">
                  <span className="text-lg font-bold font-mono text-[var(--parchment)]">{myCharacter.xp}</span>
                  <span className="text-[9px] uppercase font-mono text-[var(--muted-text)] block tracking-wider mt-1">XP</span>
                </div>
                <div className="p-2.5 border border-[var(--game-border)]/30 rounded-md bg-[var(--obsidian)]">
                  <span className="text-lg font-bold font-mono text-yellow-500/90 flex items-center justify-center gap-1">
                    <Coins className="h-3.5 w-3.5" /> {myCharacter.gold}g
                  </span>
                  <span className="text-[9px] uppercase font-mono text-[var(--muted-text)] block tracking-wider mt-1">Gold</span>
                </div>
                <div className="p-2.5 border border-[var(--game-border)]/30 rounded-md bg-[var(--obsidian)]">
                  <span className="text-lg font-bold font-mono text-[var(--parchment)] flex items-center justify-center gap-1">
                    <Shield className="h-3.5 w-3.5 text-zinc-400" /> {derivedAc}
                  </span>
                  <span className="text-[9px] uppercase font-mono text-[var(--muted-text)] block tracking-wider mt-1">AC</span>
                </div>
                <div className="p-2.5 border border-[var(--game-border)]/30 rounded-md bg-[var(--obsidian)]">
                  <span className="text-lg font-bold font-mono text-[var(--parchment)] flex items-center justify-center gap-1">
                    <Sword className="h-3.5 w-3.5 text-red-400" /> +{attackBonus}
                  </span>
                  <span className="text-[9px] uppercase font-mono text-[var(--muted-text)] block tracking-wider mt-1">Attack</span>
                </div>
                <div className="p-2.5 border border-[var(--game-border)]/30 rounded-md bg-[var(--obsidian)]">
                  <span className="text-lg font-bold font-mono text-[var(--parchment)]">
                    {displaySpellcasting || "-"}
                  </span>
                  <span className="text-[9px] uppercase font-mono text-[var(--muted-text)] block tracking-wider mt-1">Spell DC</span>
                </div>
                <div className="p-2.5 border border-[var(--game-border)]/30 rounded-md bg-[var(--obsidian)]">
                  <span className="text-lg font-bold font-mono text-[var(--parchment)]">
                    {myCharacter.hp_current}/{myCharacter.hp_max}
                  </span>
                  <span className="text-[9px] uppercase font-mono text-[var(--muted-text)] block tracking-wider mt-1">HP</span>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Inventory Card */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
            <CardHeader className="pb-3 border-b border-[var(--game-border)]/50">
              <CardTitle className="text-md uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                <BookOpen className="h-4.5 w-4.5" /> Character Inventory
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {inventory.length === 0 ? (
                <p className="text-xs text-zinc-500 italic py-4">No items are carried in your pack.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {inventory.map((item) => (
                    <div 
                      key={item.id} 
                      className={cn(
                        "p-3.5 border rounded-md text-xs space-y-2 relative transition-all duration-200",
                        item.is_equipped 
                          ? "border-[var(--runic-gold)] bg-amber-950/10 shadow-sm" 
                          : "border-[var(--game-border)]/45 bg-[var(--obsidian)]/30"
                      )}
                    >
                      {item.is_equipped && (
                        <Badge variant="default" className="absolute top-2.5 right-2.5 text-[8px] uppercase tracking-wider font-mono px-1 py-0.1 bg-[var(--runic-gold)] text-[var(--obsidian)]">
                          Equipped
                        </Badge>
                      )}
                      
                      <div className="space-y-0.5">
                        <strong className="text-[var(--parchment)] block truncate pr-14">{item.name}</strong>
                        <span className="text-[10px] text-[var(--muted-text)] uppercase font-mono tracking-wider">
                          {item.type} {item.quantity > 1 && `x${item.quantity}`}
                        </span>
                      </div>

                      {item.description && (
                        <p className="text-zinc-400 text-[11px] leading-snug line-clamp-2">{item.description}</p>
                      )}

                      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--game-border)]/15">
                        {!item.is_consumable && (
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            onClick={() => toggleInventoryEquip(item)}
                            className="h-7 text-[10px] cursor-pointer"
                          >
                            {item.is_equipped ? "Unequip" : "Equip"}
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => dropInventoryItem(item)}
                          className="h-7 text-[10px] text-zinc-400 hover:text-[var(--deep-crimson)] cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Drop
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Right Side: Attributes, Skills & Reputation (5/12) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Attributes List */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
            <CardHeader className="pb-3 border-b border-[var(--game-border)]/50">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                <Dices className="h-4.5 w-4.5" /> Core attributes
              </CardTitle>
              <CardDescription className="text-[10px] text-[var(--muted-text)] font-mono">
                Click any attribute row to roll a test check.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(myCharacter.attributes).map(([attr, score]) => {
                  const s = Number(score)
                  const mod = Math.floor((s - 10) / 2)
                  return (
                    <Button
                      key={attr}
                      variant="outline"
                      disabled={wsStatus !== "connected"}
                      onClick={() => rollAttribute(attr, s)}
                      className="h-14 flex flex-col items-center justify-center border-[var(--game-border)] bg-[var(--obsidian)]/20 hover:border-[var(--runic-gold)] hover:bg-[var(--game-muted)]/40 p-2 cursor-pointer transition-all duration-200"
                    >
                      <span className="text-[10px] font-mono text-[var(--muted-text)] uppercase">{attr}</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-md font-bold text-[var(--parchment)] font-mono">{s}</span>
                        <span className="text-xs font-mono text-[var(--runic-gold)]">
                          ({mod >= 0 ? `+${mod}` : mod})
                        </span>
                      </div>
                    </Button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Skills Checklist Grid */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
            <CardHeader className="pb-3 border-b border-[var(--game-border)]/50">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                <PlusCircle className="h-4.5 w-4.5" /> Trained Skills
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 max-h-[260px] overflow-y-auto pr-2">
              <div className="space-y-1">
                {(Object.entries(myCharacter.skills || {}) as Array<[string, number]>).map(([skill, bonus]) => {
                  const b = Number(bonus)
                  return (
                    <Button
                      key={skill}
                      variant="ghost"
                      disabled={wsStatus !== "connected"}
                      onClick={() => rollSkill(skill, b)}
                      className="w-full h-8 flex justify-between items-center text-xs text-[var(--muted-text)] hover:text-[var(--parchment)] hover:bg-[var(--game-muted)]/40 px-2.5 cursor-pointer rounded"
                    >
                      <span className="capitalize font-mono text-[11px]">
                        {skill.replace(/([A-Z])/g, " $1")}
                      </span>
                      <span className="font-mono text-[var(--runic-gold)]">
                        {b >= 0 ? `+${b}` : b}
                      </span>
                    </Button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Faction Reputations */}
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
            <CardHeader className="pb-3 border-b border-[var(--game-border)]/50">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                <FolderHeart className="h-4.5 w-4.5" /> Faction Reputations
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2">
              {reputations
                .filter((r) => r.character_id === myCharacter.id)
                .map((rep) => {
                  const faction = factions.find((f) => f.id === rep.faction_id)
                  if (!faction) return null

                  const isFactionHidden = faction.is_hidden
                  const factionNameDisplay = isFactionHidden ? "??? (Hidden Faction)" : faction.name

                  const tierColors: Record<string, string> = {
                    legend: "text-amber-400 border-amber-400/50 bg-amber-500/10",
                    champion: "text-purple-400 border-purple-400/50 bg-purple-500/10",
                    watched: "text-orange-400 border-orange-400/50 bg-orange-500/10",
                    wanted: "text-red-400 border-red-400/50 bg-red-500/10",
                    hunted: "text-red-700 border-red-700/50 bg-red-900/15"
                  }
                  const badgeColor = tierColors[rep.tier] || "text-zinc-400 border-zinc-700 bg-zinc-800/20"

                  return (
                    <div key={rep.id} className="p-3 border border-[var(--game-border)]/20 rounded bg-[var(--obsidian)]/20 flex justify-between items-center text-xs">
                      <span className={cn(isFactionHidden ? "text-zinc-500 italic" : "text-[var(--parchment)]")}>
                        {factionNameDisplay}
                      </span>
                      <Badge variant="outline" className={cn("capitalize font-mono text-[10px] tracking-wider", badgeColor)}>
                        {rep.tier} ({rep.score})
                      </Badge>
                    </div>
                  )
                })}
              {reputations.filter((r) => r.character_id === myCharacter.id).length === 0 && (
                <p className="text-xs text-zinc-500 italic">No affiliations or reputations logged.</p>
              )}
            </CardContent>
          </Card>

        </div>

      </div>

      {/* ASI Points allocation Dialog */}
      {showAsiDialog && (
        <Dialog open={showAsiDialog} onOpenChange={setShowAsiDialog}>
          <DialogContent className="sm:max-w-md bg-[var(--game-card)] border-[var(--game-border)] text-[var(--parchment)]">
            <DialogHeader>
              <DialogTitle className="text-lg text-[var(--runic-gold)] font-serif">ASI Stat Allocator</DialogTitle>
              <DialogDescription className="text-zinc-400 text-xs">
                Distribute up to {availableAsiPoints} points. Statistics are capped at 20.
              </DialogDescription>
            </DialogHeader>

            {allocationError && (
              <div className="p-3 bg-red-950/40 border border-red-500/50 rounded text-xs text-red-200 font-mono">
                {allocationError}
              </div>
            )}

            <div className="space-y-3 pt-3">
              {Object.keys(myCharacter.attributes).map((attrKey) => {
                const attr = attrKey as keyof typeof myCharacter.attributes
                const currentVal = myCharacter.attributes[attr]
                const tempVal = tempAttributes[attr] ?? currentVal

                const spentPoints = Object.entries(tempAttributes).reduce(
                  (sum, [k, v]) => sum + (v - myCharacter.attributes[k as keyof typeof myCharacter.attributes]),
                  0
                )
                const canIncrease = tempVal < 20 && spentPoints < availableAsiPoints
                const canDecrease = tempVal > currentVal

                return (
                  <div key={attr} className="flex justify-between items-center bg-[var(--obsidian)]/30 border border-[var(--game-border)]/15 px-3 py-2 rounded-md">
                    <span className="text-xs font-bold font-mono uppercase text-[var(--parchment)]">
                      {attr} ({currentVal})
                    </span>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canDecrease}
                        onClick={() => setTempAttributes(prev => ({ ...prev, [attr]: Math.max(currentVal, (prev[attr] ?? currentVal) - 1) }))}
                        className="h-7 w-7 border border-[var(--game-border)] text-xs cursor-pointer"
                      >
                        -
                      </Button>
                      <span className="w-6 text-center font-mono font-bold text-[var(--runic-gold)]">
                        {tempVal}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canIncrease}
                        onClick={() => setTempAttributes(prev => ({ ...prev, [attr]: Math.min(20, (prev[attr] ?? currentVal) + 1) }))}
                        className="h-7 w-7 border border-[var(--game-border)] text-xs cursor-pointer"
                      >
                        +
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            {(() => {
              const spentPoints = Object.entries(tempAttributes).reduce(
                (sum, [k, v]) => sum + (v - myCharacter.attributes[k as keyof typeof myCharacter.attributes]),
                0
              )
              const remaining = availableAsiPoints - spentPoints

              return (
                <div className="pt-3 border-t border-[var(--game-border)]/20 flex flex-col gap-3">
                  <span className="text-xs font-mono text-[var(--muted-text)]">
                    Remaining Points: <strong className="text-[var(--runic-gold)]">{remaining}</strong>
                  </span>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowAsiDialog(false)}>
                      Cancel
                    </Button>
                    <Button variant="default" size="sm" onClick={handleSaveAsi} className="cursor-pointer">
                      Save Changes
                    </Button>
                  </DialogFooter>
                </div>
              )
            })()}

          </DialogContent>
        </Dialog>
      )}

    </div>
  )
}
export default CharacterSheetPage;
