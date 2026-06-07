import { useAuthStore } from "./stores/authStore";
import { useGameStore } from "./stores/gameStore";
import { AuthPage } from "./pages/AuthPage";
import { LobbyPage } from "./pages/LobbyPage";
import { GamePage } from "./pages/GamePage";

function App() {
  const { token, user } = useAuthStore();
  const { activeCampaign } = useGameStore();

  if (!token || !user) return <AuthPage />;
  if (activeCampaign) return <GamePage />;
  return <LobbyPage />;
}

export default App;
