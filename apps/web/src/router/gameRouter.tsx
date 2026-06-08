import React from "react"
import { HashRouter, Routes, Route, Navigate } from "react-router-dom"
import { CampaignProvider } from "@/context/CampaignContext"
import { RootLayout } from "@/components/navigation/RootLayout"
import { DmOnlyRoute, CombatActiveRoute } from "@/components/navigation/Guards"
import { DashboardPage } from "@/pages/campaign/DashboardPage"
import { CombatPage } from "@/pages/campaign/CombatPage"
import { CharacterSheetPage } from "@/pages/campaign/CharacterSheetPage"
import { JournalPage } from "@/pages/campaign/JournalPage"
import { MenuPage } from "@/pages/campaign/MenuPage"
import { FactionsPage } from "@/pages/campaign/FactionsPage"
import { BalancePage } from "@/pages/campaign/BalancePage"

export const GameRouter: React.FC = () => {
  return (
    <HashRouter>
      <CampaignProvider>
        <Routes>
          <Route path="/" element={<RootLayout />}>
            {/* Root redirects to dashboard */}
            <Route index element={<Navigate to="dashboard" replace />} />
            
            {/* Player gameplay menus guarded by CombatActiveRoute */}
            <Route 
              path="dashboard" 
              element={
                <CombatActiveRoute>
                  <DashboardPage />
                </CombatActiveRoute>
              } 
            />
            <Route 
              path="character" 
              element={
                <CombatActiveRoute>
                  <CharacterSheetPage />
                </CombatActiveRoute>
              } 
            />
            
            {/* General gameplay viewports */}
            <Route path="combat" element={<CombatPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="menu" element={<MenuPage />} />
            
            {/* Dungeon Master override viewports */}
            <Route 
              path="factions" 
              element={
                <DmOnlyRoute>
                  <FactionsPage />
                </DmOnlyRoute>
              } 
            />
            <Route 
              path="balance" 
              element={
                <DmOnlyRoute>
                  <BalancePage />
                </DmOnlyRoute>
              } 
            />
            
            {/* Fallback route */}
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Route>
        </Routes>
      </CampaignProvider>
    </HashRouter>
  )
}
export default GameRouter;
