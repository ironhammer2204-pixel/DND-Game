import React from "react"
import { Outlet } from "react-router-dom"
import { DesktopNav } from "./DesktopNav"
import { MobileNav } from "./MobileNav"
import { StaleDataBanner } from "../game/StaleDataBanner"
import { DiceRoll } from "../game/DiceRoll"
import { Toaster } from "@/components/ui/sonner"
import "@/styles/game-theme.css"

export const RootLayout: React.FC = () => {
  return (
    <div className="game-shell flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-[var(--obsidian)] text-[var(--parchment)]">
      {/* Sidebar - Desktop */}
      <div className="hidden md:flex h-full shrink-0">
        <DesktopNav />
      </div>

      {/* Main Content Area */}
      <div className="flex-grow flex flex-col h-full overflow-hidden">
        {/* Reconnect Banner */}
        <StaleDataBanner />

        {/* Dynamic Route Viewport */}
        <main className="flex-1 overflow-y-auto min-h-0 relative bg-zinc-950/40">
          <Outlet />
        </main>

        {/* Bottom Nav - Mobile */}
        <MobileNav />
      </div>

      {/* Overlays & Alerts */}
      <DiceRoll />
      <Toaster />
    </div>
  )
}
export default RootLayout;
