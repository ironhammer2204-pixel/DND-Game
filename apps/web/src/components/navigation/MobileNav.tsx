import React from "react"
import { NavLink } from "react-router-dom"
import { 
  LayoutDashboard, 
  Swords, 
  User, 
  BookOpen, 
  Settings 
} from "lucide-react"
import { cn } from "@/lib/utils"

export const MobileNav: React.FC = () => {

  const links = [
    { to: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "combat", label: "Combat", icon: Swords },
    { to: "character", label: "Sheet", icon: User },
    { to: "journal", label: "Journal", icon: BookOpen },
    { to: "menu", label: "Menu", icon: Settings },
  ]

  return (
    <nav className="border-t border-[var(--game-border)] bg-[var(--game-card)] flex justify-around items-center h-16 select-none md:hidden">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center justify-center flex-1 h-full text-[10px] font-medium transition-all duration-200",
              isActive
                ? "text-[var(--runic-gold)] bg-[var(--game-muted)]/40 font-bold"
                : "text-[var(--muted-text)] hover:text-[var(--parchment)]"
            )
          }
        >
          <link.icon className="h-4.5 w-4.5 mb-1" />
          <span>{link.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
export default MobileNav;
