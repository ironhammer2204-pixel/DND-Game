import React, { useState } from "react"
import { useCampaign } from "@/context/CampaignContext"
import { useAuthStore } from "@/stores/authStore"
import { EncyclopediaPanel } from "@/components/EncyclopediaPanel"
import { NemesisGallery } from "@/components/NemesisGallery"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { 
  BookOpen, 
  Skull, 
  Compass, 
  BookMarked
} from "lucide-react"
import { cn } from "@/lib/utils"

export const JournalPage: React.FC = () => {
  const {
    activeCampaign,
    activeRole,
    quests,
    nemeses,
    factions,
    questsError,
    toggleQuestObjective,
    myCharacter
  } = useCampaign()

  const { token } = useAuthStore()
  const [journalTab, setJournalTab] = useState("quests")

  const activeQuests = quests.filter((q) => q.status === "active")
  const completedQuests = quests.filter((q) => q.status === "complete")

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto game-animate-fade-in">
      
      {/* Page Title */}
      <div className="flex items-center gap-3 border-b border-[var(--game-border)] pb-4">
        <BookMarked className="h-6 w-6 text-[var(--runic-gold)]" />
        <div>
          <h2 className="text-xl font-serif font-bold text-[var(--parchment)]">
            ADVENTURER'S JOURNAL
          </h2>
          <p className="text-xs text-[var(--muted-text)] font-mono">
            Track quests, read campaign lore, discover codex entries, and review Nemesis updates.
          </p>
        </div>
      </div>

      {/* Tabs Container */}
      <Tabs value={journalTab} onValueChange={setJournalTab} className="w-full space-y-4">
        <TabsList className="bg-[var(--game-card)] border border-[var(--game-border)] p-1 rounded-md">
          <TabsTrigger value="quests" className="text-xs flex items-center gap-1.5 cursor-pointer">
            <Compass className="h-4 w-4" /> Quests ({quests.length})
          </TabsTrigger>
          <TabsTrigger value="encyclopedia" className="text-xs flex items-center gap-1.5 cursor-pointer">
            <BookOpen className="h-4 w-4" /> Codex / Encyclopedia
          </TabsTrigger>
          <TabsTrigger value="nemesis" className="text-xs flex items-center gap-1.5 cursor-pointer">
            <Skull className="h-4 w-4" /> Nemeses ({nemeses.length})
          </TabsTrigger>
        </TabsList>

        {/* Quests Content Tab */}
        <TabsContent value="quests" className="space-y-6">
          {questsError && (
            <div className="p-3 bg-red-950/45 border border-red-500/50 rounded text-xs text-red-200 font-mono">
              {questsError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Active Quests Panel */}
            <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
              <CardHeader className="border-b border-[var(--game-border)]/50 pb-3">
                <CardTitle className="text-md uppercase tracking-wider flex items-center gap-1.5 font-serif text-[var(--runic-gold)]">
                  Active Quests
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {activeQuests.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic py-4">No active quests are currently tracked.</p>
                ) : (
                  activeQuests.map((quest) => (
                    <div key={quest.id} className="p-4 border border-[var(--game-border)]/20 rounded-md bg-[var(--obsidian)]/20 space-y-3">
                      <div className="flex justify-between items-start">
                        <strong className="text-sm text-[var(--parchment)] block">{quest.title}</strong>
                        <Badge variant="secondary" className="capitalize text-[9px] font-mono tracking-wider">
                          {quest.type}
                        </Badge>
                      </div>
                      
                      {quest.description && (
                        <p className="text-xs text-zinc-400 leading-relaxed">{quest.description}</p>
                      )}

                      {/* Quest Objectives checklist */}
                      <div className="space-y-2 pt-2 border-t border-[var(--game-border)]/15">
                        <span className="text-[10px] uppercase font-mono tracking-widest text-[var(--runic-gold)] block">
                          Objectives
                        </span>
                        <div className="space-y-1.5">
                          {quest.objectives.map((obj, idx) => (
                            <label 
                              key={`${quest.id}-${idx}`}
                              className={cn(
                                "flex items-start gap-2.5 text-xs text-zinc-300 select-none",
                                activeRole === "dm" ? "cursor-pointer hover:text-[var(--parchment)]" : ""
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={obj.completed}
                                disabled={activeRole !== "dm"}
                                onChange={(e) => void toggleQuestObjective(quest, idx, e.target.checked)}
                                className="mt-0.5 rounded border-[var(--game-border)] bg-[var(--obsidian)] text-[var(--runic-gold)] focus:ring-[var(--runic-gold)] cursor-pointer"
                              />
                              <span className={cn(obj.completed ? "line-through text-zinc-500" : "")}>
                                {obj.text}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Completed Quests Panel */}
            <Card className="border-[var(--game-border)] bg-[var(--game-card)] shadow-md">
              <CardHeader className="border-b border-[var(--game-border)]/50 pb-3">
                <CardTitle className="text-md uppercase tracking-wider flex items-center gap-1.5 font-serif text-zinc-400">
                  Completed Quests
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {completedQuests.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic py-4">No completed quests yet.</p>
                ) : (
                  completedQuests.map((quest) => (
                    <div key={quest.id} className="p-3 border border-[var(--game-border)]/15 rounded bg-[var(--obsidian)]/10 flex justify-between items-center opacity-70">
                      <span className="text-xs text-zinc-300 font-medium line-through">
                        {quest.title}
                      </span>
                      <Badge variant="outline" className="text-[9px] font-mono tracking-wider border-emerald-500/30 text-emerald-400 bg-emerald-950/10">
                        ✓ Complete
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

          </div>
        </TabsContent>

        {/* Encyclopedia Panel Wrapper */}
        <TabsContent value="encyclopedia">
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] p-4">
            {activeCampaign && token && (
              <EncyclopediaPanel
                campaignId={activeCampaign.id}
                token={token}
                isDM={activeRole === "dm"}
                characterId={myCharacter?.id}
              />
            )}
          </Card>
        </TabsContent>

        {/* Nemesis Gallery Wrapper */}
        <TabsContent value="nemesis">
          <Card className="border-[var(--game-border)] bg-[var(--game-card)] p-4">
            {activeCampaign && token && (
              <NemesisGallery
                campaignId={activeCampaign.id}
                token={token}
                nemeses={nemeses}
                factions={factions}
                isDM={activeRole === "dm"}
                onUpdate={() => {}}
              />
            )}
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
export default JournalPage;
