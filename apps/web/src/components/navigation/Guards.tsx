import React from "react"
import { Navigate, Outlet } from "react-router-dom"
import { useCampaign } from "@/context/CampaignContext"

interface GuardProps {
  children?: React.ReactNode;
}

export const DmOnlyRoute: React.FC<GuardProps> = ({ children }) => {
  const { activeRole } = useCampaign()

  if (activeRole !== "dm") {
    return <Navigate to="/dashboard" replace />
  }

  return children ? <>{children}</> : <Outlet />
}

export const CombatActiveRoute: React.FC<GuardProps> = ({ children }) => {
  const { activeCombat } = useCampaign()

  // If combat is active, force navigation to combat viewport
  if (activeCombat) {
    return <Navigate to="/combat" replace />
  }

  return children ? <>{children}</> : <Outlet />
}
