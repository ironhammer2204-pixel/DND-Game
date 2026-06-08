import React from "react"
import { NavLink } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"
import { 
  LayoutDashboard, 
  Swords, 
  User, 
  BookOpen, 
  Settings, 
  Users2, 
  Scale, 
  Crown 
} from "lucide-react"
import { cn } from "@/lib/utils"

export const DesktopNav: React.FC = () => {
  const { activeRole, activeCampaign } = useCampaign()

  const links = [
    { to: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "combat", label: "Combat", icon: Swords },
    { to: "character", label: "Character", icon: User },
    { to: "journal", label: "Journal", icon: BookOpen },
  ]

  const dmLinks = [
    { to: "factions", label: "Factions (DM)", icon: Users2 },
    { to: "balance", label: "Balance (DM)", icon: Scale },
  ]

  return (
    <aside className="w-64 border-r border-[var(--game-border)] bg-[var(--game-card)] flex flex-col h-full select-none">
      {/* Campaign Header Badge */}
      <div className="p-6 border-b border-[var(--game-border)]">
        <div className="flex items-center gap-2 mb-2">
          <Crown className="h-4 w-4 text-[var(--runic-gold)]" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--runic-gold)] font-serif truncate">
            {activeCampaign?.name}
          </h2>
        </div>
        <p className="text-[10px] text-[var(--muted-text)] font-mono">
          ROLE: <span className="text-[var(--parchment)] uppercase font-semibold">{activeRole}</span>
        </p>
      </div>

      {/* Main Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        <p className="px-3 text-[10px] font-mono text-[var(--muted-text)] uppercase tracking-wider mb-2">
          Adventure
        </p>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-[var(--game-muted)] text-[var(--runic-gold)] border-l-2 border-[var(--runic-gold)] shadow-sm font-semibold"
                  : "text-[var(--muted-text)] hover:text-[var(--parchment)] hover:bg-[var(--game-muted)]/50"
              )
            }
          >
            <link.icon className="h-4 w-4 shrink-0" />
            <span>{link.label}</span>
          </NavLink>
        ))}

        {/* DM Operations */}
        {activeRole === "dm" && (
          <div className="pt-6 space-y-1">
            <p className="px-3 text-[10px] font-mono text-[var(--muted-text)] uppercase tracking-wider mb-2">
              DM Control Room
            </p>
            {dmLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-[var(--game-muted)] text-[var(--runic-gold)] border-l-2 border-[var(--runic-gold)] shadow-sm font-semibold"
                      : "text-[var(--muted-text)] hover:text-[var(--parchment)] hover:bg-[var(--game-muted)]/50"
                  )
                }
              >
                <link.icon className="h-4 w-4 shrink-0" />
                <span>{link.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      {/* Settings Footer */}
      <div className="p-4 border-t border-[var(--game-border)]">
        <NavLink
          to="menu"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 w-full",
              isActive
                ? "bg-[var(--game-muted)] text-[var(--runic-gold)] font-semibold"
                : "text-[var(--muted-text)] hover:text-[var(--parchment)] hover:bg-[var(--game-muted)]/50"
            )
          }
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span>Campaign Settings</span>
        </NavLink>
      </div>
    </aside>
  )
}
export default DesktopNav;
