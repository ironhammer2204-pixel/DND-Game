import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ArrowLeft,
  BookOpen,
  Swords,
  Shield,
  Zap,
  Users,
  Scroll,
  Star,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Skull,
  MapPin,
  BookMarked,
  Sparkles
} from "lucide-react"
import { cn } from "@/lib/utils"

const TUTORIAL_KEY = "ironhammer_tutorial_read"

interface SectionProps {
  id: string
  icon: React.ReactNode
  title: string
  badge?: string
  badgeColor?: string
  children: React.ReactNode
  defaultOpen?: boolean
}

const TutorialSection: React.FC<SectionProps> = ({
  id, icon, title, badge, badgeColor, children, defaultOpen = false
}) => {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-[var(--game-border)] rounded-lg overflow-hidden bg-[var(--game-card)] shadow-md">
      <button
        id={`tutorial-section-${id}`}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--game-muted)]/30 transition-colors cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-md bg-[var(--obsidian)] border border-[var(--game-border)]/50">
            {icon}
          </div>
          <span className="font-serif font-bold text-[var(--parchment)] text-sm tracking-wide">{title}</span>
          {badge && (
            <Badge variant="outline" className={cn("text-[9px] font-mono uppercase tracking-wider", badgeColor)}>
              {badge}
            </Badge>
          )}
        </div>
        {open
          ? <ChevronDown className="h-4 w-4 text-[var(--muted-text)] shrink-0" />
          : <ChevronRight className="h-4 w-4 text-[var(--muted-text)] shrink-0" />
        }
      </button>
      {open && (
        <div className="px-5 pb-5 pt-2 border-t border-[var(--game-border)]/50 space-y-3 text-sm text-zinc-300 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  )
}

const StatRow: React.FC<{ label: string; desc: string; value?: string }> = ({ label, desc, value }) => (
  <div className="flex items-start gap-3 py-2 border-b border-[var(--game-border)]/20 last:border-0">
    <code className="text-[var(--runic-gold)] font-mono text-xs font-bold min-w-[48px] mt-0.5">{label}</code>
    <div className="flex-1">
      <span className="text-[var(--parchment)] text-xs">{desc}</span>
    </div>
    {value && <Badge variant="secondary" className="text-[9px] font-mono shrink-0">{value}</Badge>}
  </div>
)

const Step: React.FC<{ num: number; text: string; sub?: string }> = ({ num, text, sub }) => (
  <div className="flex gap-3 items-start">
    <div className="w-6 h-6 rounded-full bg-[var(--runic-gold)]/20 border border-[var(--runic-gold)]/50 flex items-center justify-center shrink-0 mt-0.5">
      <span className="text-[10px] font-bold text-[var(--runic-gold)] font-mono">{num}</span>
    </div>
    <div>
      <p className="text-xs text-[var(--parchment)]">{text}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-0.5 italic">{sub}</p>}
    </div>
  </div>
)

export const TutorialPage: React.FC = () => {
  const navigate = useNavigate()
  const { activeRole } = useCampaign()
  const [isRead, setIsRead] = useState(false)

  useEffect(() => {
    setIsRead(localStorage.getItem(TUTORIAL_KEY) === "true")
  }, [])

  const markRead = () => {
    localStorage.setItem(TUTORIAL_KEY, "true")
    setIsRead(true)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 game-animate-fade-in">

      {/* Header */}
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
        <BookOpen className="h-6 w-6 text-[var(--runic-gold)]" />
        <div>
          <h1 className="text-xl font-serif font-bold text-[var(--parchment)]">HOW TO PLAY</h1>
          <p className="text-xs text-[var(--muted-text)] font-mono">Ironhammer — Adventurer's Handbook</p>
        </div>
        {isRead && (
          <div className="ml-auto flex items-center gap-1.5 text-emerald-400 text-xs font-mono">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Read
          </div>
        )}
      </div>

      {/* Welcome Banner */}
      <Card className="border-[var(--runic-gold)]/30 bg-amber-950/10 shadow-md">
        <CardContent className="pt-5 pb-4">
          <div className="flex gap-4 items-start">
            <div className="text-3xl">⚔️</div>
            <div>
              <h2 className="text-base font-serif font-bold text-[var(--runic-gold)] mb-1">Welcome to Ironhammer</h2>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Ironhammer is a collaborative, real-time Dungeons & Dragons campaign tool. 
                One player acts as the <strong className="text-[var(--parchment)]">Dungeon Master (DM)</strong> — 
                narrating the world, managing combat encounters, and controlling factions. 
                All other players create <strong className="text-[var(--parchment)]">adventurer characters</strong> and explore together.
              </p>
              {activeRole === "dm" && (
                <div className="mt-3 p-2.5 bg-amber-950/20 border border-[var(--runic-gold)]/30 rounded text-[11px] text-amber-200/80 font-mono">
                  🎲 You are the <strong>Dungeon Master</strong>. You control the world. Other players depend on you to set the stage.
                </div>
              )}
              {activeRole === "player" && (
                <div className="mt-3 p-2.5 bg-blue-950/20 border border-blue-500/30 rounded text-[11px] text-blue-200/80 font-mono">
                  🧙 You are a <strong>Player</strong>. Create your adventurer, explore, and work with your party.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tutorial Sections */}
      <div className="space-y-3">

        {/* Getting Started */}
        <TutorialSection
          id="start"
          icon={<Star className="h-4 w-4 text-[var(--runic-gold)]" />}
          title="Your First Steps"
          badge="Start Here"
          badgeColor="border-emerald-500/50 text-emerald-400"
          defaultOpen={true}
        >
          <div className="space-y-3">
            <Step num={1} text="Join or create a campaign from the Lobby." sub="DMs create campaigns; players join via a 6-character invite code." />
            <Step num={2} text="Create your adventurer character." sub="Go to Character Sheet → choose a Race and Class → click Spawn Adventurer." />
            <Step num={3} text="Explore the world from the Dashboard." sub="The Dashboard shows your current location, NPCs, and travel routes." />
            <Step num={4} text="Talk, roll dice, and interact." sub="Type in the narrative log to chat or describe actions. Roll dice from the Quick Dice panel." />
            <Step num={5} text="Check the Journal for quests and lore." sub="Your active quests, codex entries, and nemesis gallery live in the Journal tab." />
          </div>
          {activeRole !== "dm" && (
            <Button
              className="mt-4 cursor-pointer"
              size="sm"
              onClick={() => navigate("../character")}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Create My Character →
            </Button>
          )}
        </TutorialSection>

        {/* Understanding Stats */}
        <TutorialSection
          id="stats"
          icon={<Shield className="h-4 w-4 text-blue-400" />}
          title="Understanding Your Stats"
        >
          <p className="text-[11px] text-zinc-500 mb-2 font-mono">These numbers define your adventurer. Hover any to learn more.</p>
          <StatRow label="HP" desc="Hit Points — your health. Reaches 0 and you're downed. Rest to recover." value="Max varies by class" />
          <StatRow label="AC" desc="Armor Class — how hard you are to hit. Higher is better. Calculated from DEX + armor." />
          <StatRow label="XP" desc="Experience Points — earned from combat & quests. Accumulate to level up." />
          <StatRow label="Gold" desc="Currency earned from looting enemies. Used for trading and shop purchases." />
          <StatRow label="Prof" desc="Proficiency Bonus — added to attack rolls and skill checks. Scales with level." />
          <StatRow label="Attack" desc="Your attack bonus = Proficiency + max(STR, DEX). Added to d20 attack rolls." />
          <StatRow label="SpellDC" desc="Spell Save DC — enemies must roll higher than this to resist your spells." />

          <div className="pt-3 border-t border-[var(--game-border)]/30">
            <p className="text-xs font-mono text-[var(--runic-gold)] uppercase tracking-widest mb-2">The 6 Core Attributes</p>
            <StatRow label="STR" desc="Strength — melee attacks, lifting, grappling." />
            <StatRow label="DEX" desc="Dexterity — ranged attacks, stealth, initiative, AC." />
            <StatRow label="CON" desc="Constitution — max hit points, concentration spells." />
            <StatRow label="INT" desc="Intelligence — arcane magic, knowledge checks, investigation." />
            <StatRow label="WIS" desc="Wisdom — divine magic, perception, healing." />
            <StatRow label="CHA" desc="Charisma — persuasion, deception, bardic/warlock/paladin magic." />
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">
            💡 Each attribute gives a <strong className="text-zinc-300">modifier</strong>: (score − 10) ÷ 2, rounded down. A score of 14 gives +2.
          </p>
        </TutorialSection>

        {/* Combat */}
        <TutorialSection
          id="combat"
          icon={<Swords className="h-4 w-4 text-red-400" />}
          title="How Combat Works"
          badge="D&D Rules"
          badgeColor="border-red-500/40 text-red-400"
        >
          <div className="space-y-3">
            <Step
              num={1}
              text="The DM starts combat by selecting monsters and clicking 'Summon Foes & Roll Initiative'."
              sub="Initiative order is determined automatically (d20 + DEX modifier)."
            />
            <Step
              num={2}
              text="On your turn, choose an action: ⚔️ Attack, 🛡️ Dodge, or End Turn."
              sub="Attack rolls a d20 + attack bonus. If it meets or beats the enemy's AC, you hit!"
            />
            <Step
              num={3}
              text="Enemies take their turns automatically."
              sub="The system handles enemy AI — watch the narrative log for results."
            />
            <Step
              num={4}
              text="If your HP reaches 0, you're downed."
              sub="Roll Death Saves each turn. 3 successes = stable. 3 failures = dead."
            />
            <Step
              num={5}
              text="Winning combat awards XP and loot."
              sub="XP flows to all party members. Check your Character Sheet after battle."
            />
          </div>

          <div className="mt-3 p-3 bg-red-950/15 border border-red-500/20 rounded text-[11px] space-y-1">
            <p className="text-red-300 font-mono uppercase tracking-wider text-[10px]">Conditions</p>
            <p className="text-zinc-400">
              <strong className="text-zinc-200">Poisoned</strong> — disadvantage on attacks and ability checks.<br />
              <strong className="text-zinc-200">Stunned</strong> — can't move or take actions for one round.<br />
              <strong className="text-zinc-200">Paralysed</strong> — automatically fail STR/DEX saves. Attacks have advantage.<br />
              <strong className="text-zinc-200">Dodging</strong> — attacks against you have disadvantage until next turn.
            </p>
          </div>
        </TutorialSection>

        {/* Journal / Quests */}
        <TutorialSection
          id="journal"
          icon={<BookMarked className="h-4 w-4 text-purple-400" />}
          title="The Journal — Quests, Codex & Nemeses"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-[var(--obsidian)]/40 border border-[var(--game-border)]/30 rounded-md">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-base">🗺️</span>
                <span className="text-xs font-bold text-[var(--parchment)]">Quests</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Your active missions. Track objectives — check them off when complete (DM controls).
              </p>
            </div>
            <div className="p-3 bg-[var(--obsidian)]/40 border border-[var(--game-border)]/30 rounded-md">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-base">📚</span>
                <span className="text-xs font-bold text-[var(--parchment)]">Codex</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                World lore, NPC records, location history, rumors, and session summaries.
              </p>
            </div>
            <div className="p-3 bg-[var(--obsidian)]/40 border border-[var(--game-border)]/30 rounded-md">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-base">💀</span>
                <span className="text-xs font-bold text-[var(--parchment)]">Nemeses</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Enemies who survived encounters grow in power and hunt you. Watch for ambush warnings!
              </p>
            </div>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">
            💡 Enemies who escape combat become Nemeses. They level up, carry grudges, and eventually ambush the party.
          </p>
        </TutorialSection>

        {/* Exploration */}
        <TutorialSection
          id="explore"
          icon={<MapPin className="h-4 w-4 text-emerald-400" />}
          title="Exploring the World"
        >
          <p className="text-xs text-zinc-300">
            The <strong className="text-[var(--parchment)]">Dashboard</strong> is your exploration hub. From here:
          </p>
          <ul className="space-y-2 mt-2 list-none">
            {[
              ["📍", "Current Location", "See your location's name, type (village, dungeon, wilderness), and governance laws."],
              ["👥", "NPCs", "Notable characters in the area — tavern keepers, quest givers, merchants. Build relationships with them."],
              ["🗺️", "Travel", "Click 'Travel to [Location]' buttons to move. The DM may trigger random encounters while traveling."],
              ["🎲", "Dice Roller", "Roll any die (d4 through d100) with a custom modifier for skill checks, saving throws, or just for fun."],
            ].map(([icon, title, desc]) => (
              <li key={title as string} className="flex gap-3 items-start text-xs">
                <span className="text-base shrink-0">{icon}</span>
                <div>
                  <strong className="text-[var(--parchment)]">{title}</strong>
                  <span className="text-zinc-400"> — {desc}</span>
                </div>
              </li>
            ))}
          </ul>
        </TutorialSection>

        {/* Factions */}
        <TutorialSection
          id="factions"
          icon={<Users className="h-4 w-4 text-amber-400" />}
          title="Factions & Reputation"
        >
          <p className="text-xs text-zinc-300">
            The world is governed by <strong className="text-[var(--parchment)]">factions</strong> — guilds, armies, crime syndicates, and religious orders.
            Your actions affect your standing with each.
          </p>
          <div className="mt-3 space-y-2">
            {[
              ["legend / champion", "text-amber-400", "You are admired. Faction members assist you."],
              ["neutral", "text-zinc-400", "No strong ties. Factions ignore you."],
              ["watched", "text-orange-400", "Faction suspects you. Guards are wary."],
              ["wanted / hunted", "text-red-400", "Bounty on your head. Assassins are coming."],
            ].map(([tier, color, effect]) => (
              <div key={tier as string} className="flex items-start gap-3 text-xs">
                <Badge variant="outline" className={cn("text-[9px] font-mono shrink-0 mt-0.5", color)}>
                  {tier as string}
                </Badge>
                <span className="text-zinc-400">{effect as string}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">
            💡 View your faction reputations on your Character Sheet.
          </p>
        </TutorialSection>

        {/* DM Tips */}
        {activeRole === "dm" && (
          <TutorialSection
            id="dm-tips"
            icon={<Skull className="h-4 w-4 text-[var(--runic-gold)]" />}
            title="DM Tips & Controls"
            badge="DM Only"
            badgeColor="border-[var(--runic-gold)]/50 text-[var(--runic-gold)]"
          >
            <ul className="space-y-2.5 list-none">
              {[
                ["⚔️", "Start Combat", "Go to the Combat page. Select monster type and count, then click Summon Foes."],
                ["📜", "Quest Objectives", "In the Journal → Quests tab, check off quest objectives as players complete them."],
                ["💀", "Nemesis Management", "In the Journal → Nemeses tab, promote, retire, or trigger ambushes for nemesis characters."],
                ["⚑", "Faction Control Room", "Navigate to Factions (DM) to adjust faction power levels, inter-faction relations, and player reputations."],
                ["⚖️", "Balance Dashboard", "The Balance page shows world health metrics — faction pressure, encounter difficulty, and economic balance."],
                ["📚", "Codex / Encyclopedia", "Add lore entries, rumors, and session summaries from the Journal → Codex tab."],
              ].map(([icon, title, desc]) => (
                <li key={title as string} className="flex gap-3 text-xs">
                  <span className="text-sm shrink-0">{icon}</span>
                  <div>
                    <strong className="text-[var(--parchment)]">{title}</strong>
                    <span className="text-zinc-400"> — {desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </TutorialSection>
        )}

        {/* Player Tips */}
        {activeRole === "player" && (
          <TutorialSection
            id="player-tips"
            icon={<Zap className="h-4 w-4 text-blue-400" />}
            title="Player Tips"
            badge="For Players"
            badgeColor="border-blue-500/40 text-blue-400"
          >
            <ul className="space-y-2.5 list-none">
              {[
                ["🧙", "Create your character first!", "Go to Character Sheet and create your adventurer before exploring."],
                ["🎲", "Click attribute names to roll checks", "On your Character Sheet, clicking STR/DEX/etc. sends a d20 roll to the party log."],
                ["🛡️", "Equip your gear", "Items in your inventory need to be equipped to grant stat bonuses. Use the Equip button."],
                ["📜", "Check the Journal often", "Quest objectives, new lore, and nemesis updates appear here in real time."],
                ["💬", "Use the narrative log", "Describe your actions in the chat — the DM and party can see everything you do."],
                ["⚡", "Level up by earning XP", "Defeat enemies, complete quests, and visit new locations to gain XP and level up."],
              ].map(([icon, title, desc]) => (
                <li key={title as string} className="flex gap-3 text-xs">
                  <span className="text-sm shrink-0">{icon}</span>
                  <div>
                    <strong className="text-[var(--parchment)]">{title}</strong>
                    <span className="text-zinc-400"> — {desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </TutorialSection>
        )}

        {/* Quick Reference */}
        <TutorialSection
          id="reference"
          icon={<Scroll className="h-4 w-4 text-zinc-400" />}
          title="Quick Reference Cheat Sheet"
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
            {[
              ["d4", "Damage (dagger, magic missile)"],
              ["d6", "Damage (shortsword, healing)"],
              ["d8", "Damage (longsword, rapier)"],
              ["d10", "Damage (halberd, heavy bow)"],
              ["d12", "Damage (greataxe)"],
              ["d20", "Attack / skill / saving throw"],
              ["d100", "Wild magic surges"],
              ["Nat 20", "Critical hit — double damage dice!"],
              ["Nat 1", "Critical fail — something goes wrong"],
            ].map(([die, desc]) => (
              <div key={die as string} className="p-2 bg-[var(--obsidian)]/40 border border-[var(--game-border)]/20 rounded">
                <code className="text-[var(--runic-gold)] font-mono font-bold block mb-0.5">{die}</code>
                <span className="text-zinc-400">{desc}</span>
              </div>
            ))}
          </div>
        </TutorialSection>

      </div>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-[var(--game-border)]">
        <p className="text-[11px] text-zinc-500 font-mono">
          Return here anytime from the sidebar → How to Play
        </p>
        <div className="flex gap-3">
          {!isRead && (
            <Button
              variant="outline"
              size="sm"
              onClick={markRead}
              className="text-xs cursor-pointer border-emerald-500/50 text-emerald-400 hover:bg-emerald-950/20"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Mark as Read
            </Button>
          )}
          <Button size="sm" onClick={() => navigate("../dashboard")} className="text-xs cursor-pointer">
            Start Playing →
          </Button>
        </div>
      </div>

    </div>
  )
}
export default TutorialPage
