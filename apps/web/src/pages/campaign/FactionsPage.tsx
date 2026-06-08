import React from "react"
import { useNavigate } from "react-router-dom"
import { FactionControlRoom } from "@/components/FactionControlRoom"

export const FactionsPage: React.FC = () => {
  const navigate = useNavigate()

  const handleClose = () => {
    navigate("/campaign/dashboard")
  }

  return (
    <div className="w-full h-full relative game-animate-fade-in">
      {/* We render the FactionControlRoom directly and hook up the onClose to return to Dashboard */}
      <FactionControlRoom onClose={handleClose} />
    </div>
  )
}
export default FactionsPage;
