/**
 * CampaignSetupPage.tsx
 *
 * 4-step wizard for campaign creation:
 * 1. Premise — DM fills campaign details
 * 2. AI World Expansion — review generated world
 * 3. Satisfaction Check — approve or regenerate
 * 4. Launched — show opening narration, enter campaign
 */

import { useState, useCallback, useMemo } from "react";
import { useAuthStore } from "../stores/authStore";
import { API_URL } from "../config";

function getCampaignIdFromHash(): string {
  const match = window.location.hash.match(/#\/campaigns\/([^/]+)\/setup/);
  return match?.[1] || "";
}

// Step types
interface CampaignPremise {
  name: string;
  tone: "dark" | "heroic" | "mystery" | "political" | "horror";
  setting: string;
  hook: string;
  themes: string[];
  party_size: number;
  starting_level: number;
  difficulty: "easy" | "standard" | "hard" | "deadly";
  known_npcs?: string[];
  known_locations?: string[];
  villain_archetype?: string;
  session_zero_notes?: string;
}

interface WorldExpansionData {
  world_summary: string;
  opening_narration: string;
  locations: Array<{
    name: string;
    type: string;
    description: string;
    lore: string;
    state: any;
    connected_location_names: string[];
    is_starting_location: boolean;
  }>;
  npcs: Array<{
    name: string;
    archetype: string;
    role: string;
    location_name: string;
    short_description: string;
    secret: string;
  }>;
  factions: Array<{
    name: string;
    type: string;
    description: string;
    alignment: string;
    military: number;
    wealth: number;
    influence: number;
  }>;
  quests: Array<{
    title: string;
    type: string;
    description: string;
    hook: string;
    objectives: Array<{ text: string; completed: boolean }>;
    current_objective: string;
    giver_npc_name?: string;
    rewards: { gold?: number; xp?: number };
  }>;
  random_event_seeds: string[];
  nemesis_seed?: any;
}

const ALL_THEMES = [
  "betrayal", "ancient magic", "lost civilizations", "war", "corruption",
  "prophecy", "monsters", "politics", "survival", "horror", "redemption",
  "forbidden knowledge", "factions", "dragons", "undead", "pirates",
];

const TONE_OPTIONS: { value: CampaignPremise["tone"]; label: string; desc: string }[] = [
  { value: "dark", label: "Dark Fantasy", desc: "Grim, morally grey, brutal consequences" },
  { value: "heroic", label: "Heroic Fantasy", desc: "High stakes, noble deeds, epic scale" },
  { value: "mystery", label: "Mystery", desc: "Atmospheric, clues, secrets, paranoia" },
  { value: "political", label: "Political", desc: "Intrigue, factions, power struggles" },
  { value: "horror", label: "Horror", desc: "Dread, cosmic terror, body horror" },
];

const DIFFICULTY_OPTIONS: { value: CampaignPremise["difficulty"]; label: string }[] = [
  { value: "easy", label: "Easy — Forgiving, story-focused" },
  { value: "standard", label: "Standard — Classic D&D challenge" },
  { value: "hard", label: "Hard — Brutal, resource-scarce" },
  { value: "deadly", label: "Deadly — Every fight could be your last" },
];

export default function CampaignSetupPage() {
  const initialCampaignId = useMemo(() => getCampaignIdFromHash(), []);
  const { token } = useAuthStore();
  const [campaignId, setCampaignId] = useState(initialCampaignId);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Premise
  const [premise, setPremise] = useState<CampaignPremise>({
    name: "",
    tone: "dark",
    setting: "",
    hook: "",
    themes: [],
    party_size: 4,
    starting_level: 1,
    difficulty: "standard",
  });

  // Step 2: World Expansion
  const [worldData, setWorldData] = useState<WorldExpansionData | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  // Step 4: Launch
  const [openingNarration, setOpeningNarration] = useState("");

  const apiCall = useCallback(async (endpoint: string, body: unknown, method = "POST") => {
    if (!campaignId && endpoint !== "" && !endpoint.startsWith("/expand")) {
      throw new Error("Campaign not created yet");
    }
    const url = campaignId
      ? `${API_URL}/api/campaigns/${campaignId}${endpoint}`
      : `${API_URL}/api/campaigns`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [campaignId, token]);

  // Step 1 → Step 2
  const handleCreatePremise = async () => {
    if (!premise.name.trim()) { setError("Campaign name is required"); return; }
    if (!premise.setting.trim()) { setError("Setting description is required"); return; }
    if (!premise.hook.trim()) { setError("The Hook is required"); return; }
    setError("");
    setLoading(true);

    try {
      let activeId = campaignId;
      if (!activeId) {
        const created = await fetch(`${API_URL}/api/campaigns`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ ...premise, use_setup_wizard: true }),
        }).then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to create campaign");
          return data;
        });
        activeId = created.campaign.id;
        setCampaignId(activeId);
        window.location.hash = `#/campaigns/${activeId}/setup`;
      } else {
        await fetch(`${API_URL}/api/campaigns/${activeId}/settings`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(premise),
        }).then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to save settings");
          return data;
        });
      }

      const result = await fetch(`${API_URL}/api/campaigns/${activeId}/expand-world`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(premise),
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "World expansion failed");
        return data;
      });

      setWorldData(result);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Regenerate element
  const handleRegenerate = async (elementType: string, index: number) => {
    setRegenerating(`${elementType}-${index}`);
    try {
      const result = await apiCall("/regenerate-element", { element_type: elementType, element_index: index });
      // Merge regenerated element into worldData
      setWorldData((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        const key = elementType === "nemesis" ? "nemesis_seed" : `${elementType}s`;
        if (Array.isArray((next as any)[key])) {
          (next as any)[key][index] = result.element;
        } else if (key === "nemesis_seed") {
          next.nemesis_seed = result.element;
        }
        return next;
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRegenerating(null);
    }
  };

  // Step 2 → Step 3 (just advance)
  const handleReviewComplete = () => setStep(3);

  // Step 3 → Step 4 (Launch)
  const handleLaunch = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiCall("/launch", {});
      setOpeningNarration(result.opening_narration);
      setStep(4);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 4 → Enter campaign
  const handleEnterCampaign = () => {
    window.location.hash = "";
    window.location.reload();
  };

  // Render helpers
  const renderStep1 = () => (
    <div className="space-y-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-amber-400">Step 1: Campaign Premise</h2>
      <p className="text-gray-400">Define the soul of your world. The AI will expand this into a living setting.</p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Campaign Name</label>
          <input
            type="text"
            value={premise.name}
            onChange={(e) => setPremise((p) => ({ ...p, name: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:border-amber-500 focus:outline-none"
            placeholder="e.g., The Ashen Oath"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Tone</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => setPremise((p) => ({ ...p, tone: t.value }))}
                className={`p-3 rounded border text-left transition ${
                  premise.tone === t.value
                    ? "border-amber-500 bg-amber-500/10 text-amber-400"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
                }`}
              >
                <div className="font-semibold">{t.label}</div>
                <div className="text-xs text-gray-500 mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Setting (2-4 sentences)</label>
          <textarea
            value={premise.setting}
            onChange={(e) => setPremise((p) => ({ ...p, setting: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:border-amber-500 focus:outline-none h-24"
            placeholder="A crumbling empire on the edge of civil war. The old king is dead, and his three children tear the realm apart..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">The Hook (inciting incident)</label>
          <textarea
            value={premise.hook}
            onChange={(e) => setPremise((p) => ({ ...p, hook: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:border-amber-500 focus:outline-none h-20"
            placeholder="The players discover a murdered courier bearing a message that could prevent the war..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Themes</label>
          <div className="flex flex-wrap gap-2">
            {ALL_THEMES.map((theme) => (
              <button
                key={theme}
                onClick={() =>
                  setPremise((p) => ({
                    ...p,
                    themes: p.themes.includes(theme)
                      ? p.themes.filter((t) => t !== theme)
                      : [...p.themes, theme],
                  }))
                }
                className={`px-3 py-1 rounded-full text-sm border transition ${
                  premise.themes.includes(theme)
                    ? "border-amber-500 bg-amber-500/20 text-amber-400"
                    : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500"
                }`}
              >
                {theme}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Party Size (1-6)</label>
            <input
              type="number"
              min={1}
              max={6}
              value={premise.party_size}
              onChange={(e) => setPremise((p) => ({ ...p, party_size: Math.min(6, Math.max(1, parseInt(e.target.value) || 1)) }))}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Starting Level (1-20)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={premise.starting_level}
              onChange={(e) => setPremise((p) => ({ ...p, starting_level: Math.min(20, Math.max(1, parseInt(e.target.value) || 1)) }))}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Difficulty</label>
          <div className="grid grid-cols-2 gap-3">
            {DIFFICULTY_OPTIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => setPremise((p) => ({ ...p, difficulty: d.value }))}
                className={`p-3 rounded border text-left transition ${
                  premise.difficulty === d.value
                    ? "border-amber-500 bg-amber-500/10 text-amber-400"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Optional: Villain Archetype</label>
          <input
            type="text"
            value={premise.villain_archetype || ""}
            onChange={(e) => setPremise((p) => ({ ...p, villain_archetype: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            placeholder="e.g., fallen paladin, eldritch god, corrupt noble"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Optional: Session Zero Notes</label>
          <textarea
            value={premise.session_zero_notes || ""}
            onChange={(e) => setPremise((p) => ({ ...p, session_zero_notes: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white h-20"
            placeholder="Any freeform notes for the AI..."
          />
        </div>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-800">{error}</div>}

      <button
        onClick={handleCreatePremise}
        disabled={loading}
        className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 text-white font-bold py-3 rounded transition"
      >
        {loading ? "Summoning the AI Worldbuilder..." : "Generate World →"}
      </button>
    </div>
  );

  const renderStep2 = () => {
    if (!worldData) return null;
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-amber-400">Step 2: Review Your World</h2>
        <p className="text-gray-400">The AI has breathed life into your premise. Review each element. Click "Regenerate" on any you dislike.</p>

        {/* World Summary */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-amber-300 mb-2">World Summary</h3>
          <p className="text-gray-300 text-sm leading-relaxed">{worldData.world_summary}</p>
        </div>

        {/* Opening Narration */}
        <div className="bg-gray-900 border border-amber-900/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-amber-300 mb-2">Opening Narration</h3>
          <blockquote className="text-gray-300 italic border-l-4 border-amber-500 pl-4 text-sm leading-relaxed">
            {worldData.opening_narration}
          </blockquote>
        </div>

        {/* Locations */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-amber-300">Locations ({worldData.locations.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {worldData.locations.map((loc, i) => (
              <div key={i} className={`bg-gray-900 border rounded-lg p-4 ${loc.is_starting_location ? "border-amber-500" : "border-gray-700"}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold text-white">{loc.name}</h4>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">{loc.type}</span>
                    {loc.is_starting_location && <span className="ml-2 text-xs text-amber-400">★ START</span>}
                  </div>
                  <button
                    onClick={() => handleRegenerate("location", i)}
                    disabled={regenerating === `location-${i}`}
                    className="text-xs text-gray-500 hover:text-amber-400 transition"
                  >
                    {regenerating === `location-${i}` ? "..." : "↻ Regen"}
                  </button>
                </div>
                <p className="text-sm text-gray-400 mb-2">{loc.description}</p>
                <p className="text-xs text-gray-600 italic">{loc.lore}</p>
                <div className="mt-2 flex gap-2 text-xs text-gray-500">
                  <span>Law: {loc.state.law}</span>
                  <span>Tax: {loc.state.tax_percent}%</span>
                  <span>Patrol: {loc.state.patrol_level}</span>
                  <span className={loc.state.danger_level === "deadly" ? "text-red-400" : ""}>Danger: {loc.state.danger_level}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* NPCs */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-amber-300">NPCs ({worldData.npcs.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {worldData.npcs.map((npc, i) => (
              <div key={i} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold text-white">{npc.name}</h4>
                    <span className="text-xs text-gray-500">{npc.role}</span>
                  </div>
                  <button
                    onClick={() => handleRegenerate("npc", i)}
                    disabled={regenerating === `npc-${i}`}
                    className="text-xs text-gray-500 hover:text-amber-400 transition"
                  >
                    {regenerating === `npc-${i}` ? "..." : "↻ Regen"}
                  </button>
                </div>
                <p className="text-sm text-gray-400 mb-1">{npc.short_description}</p>
                <p className="text-xs text-gray-600 italic">Secret: {npc.secret}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Factions */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-amber-300">Factions ({worldData.factions.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {worldData.factions.map((fac, i) => (
              <div key={i} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold text-white">{fac.name}</h4>
                    <span className="text-xs text-gray-500">{fac.type} • {fac.alignment}</span>
                  </div>
                  <button
                    onClick={() => handleRegenerate("faction", i)}
                    disabled={regenerating === `faction-${i}`}
                    className="text-xs text-gray-500 hover:text-amber-400 transition"
                  >
                    {regenerating === `faction-${i}` ? "..." : "↻ Regen"}
                  </button>
                </div>
                <p className="text-sm text-gray-400 mb-2">{fac.description}</p>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>MIL: {fac.military}</span>
                  <span>WLT: {fac.wealth}</span>
                  <span>INF: {fac.influence}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quests */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-amber-300">Quests ({worldData.quests.length})</h3>
          {worldData.quests.map((quest, i) => (
            <div key={i} className={`bg-gray-900 border rounded-lg p-4 ${quest.type === "main" ? "border-amber-600" : "border-gray-700"}`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-semibold text-white">{quest.title}</h4>
                  <span className={`text-xs uppercase tracking-wider ${quest.type === "main" ? "text-amber-400" : "text-gray-500"}`}>
                    {quest.type}
                  </span>
                </div>
                <button
                  onClick={() => handleRegenerate("quest", i)}
                  disabled={regenerating === `quest-${i}`}
                  className="text-xs text-gray-500 hover:text-amber-400 transition"
                >
                  {regenerating === `quest-${i}` ? "..." : "↻ Regen"}
                </button>
              </div>
              <p className="text-sm text-gray-400 mb-2">{quest.description}</p>
              <p className="text-xs text-gray-500 mb-2">Hook: {quest.hook}</p>
              <div className="text-xs text-gray-500">
                Objectives: {quest.objectives.map((o) => o.text).join(" → ")}
              </div>
              {quest.giver_npc_name && <div className="text-xs text-amber-500 mt-1">Given by: {quest.giver_npc_name}</div>}
              <div className="text-xs text-gray-600 mt-2">
                Reward: {quest.rewards.gold}g / {quest.rewards.xp}xp
              </div>
            </div>
          ))}
        </div>

        {/* Random Event Seeds */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-amber-300 mb-2">Random Event Seeds</h3>
          <ul className="space-y-1">
            {worldData.random_event_seeds.map((seed, i) => (
              <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
                <span className="text-amber-500">•</span> {seed}
              </li>
            ))}
          </ul>
        </div>

        {error && <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-800">{error}</div>}

        <button
          onClick={handleReviewComplete}
          className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded transition"
        >
          Review Complete →
        </button>
      </div>
    );
  };

  const renderStep3 = () => (
    <div className="space-y-6 max-w-2xl mx-auto text-center">
      <h2 className="text-2xl font-bold text-amber-400">Step 3: Ready to Launch?</h2>
      <p className="text-gray-400">
        You have reviewed the generated world. Once launched, players can join and the adventure begins.
      </p>

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 text-left">
        <h3 className="text-lg font-semibold text-white mb-4">World Summary</h3>
        <p className="text-sm text-gray-400 mb-4">{worldData?.world_summary}</p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="text-gray-500">Locations: <span className="text-white">{worldData?.locations.length}</span></div>
          <div className="text-gray-500">NPCs: <span className="text-white">{worldData?.npcs.length}</span></div>
          <div className="text-gray-500">Factions: <span className="text-white">{worldData?.factions.length}</span></div>
          <div className="text-gray-500">Quests: <span className="text-white">{worldData?.quests.length}</span></div>
        </div>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-800">{error}</div>}

      <div className="flex gap-4">
        <button
          onClick={() => setStep(2)}
          className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded transition border border-gray-600"
        >
          ← Go Back and Adjust
        </button>
        <button
          onClick={handleLaunch}
          disabled={loading}
          className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 text-white font-bold py-3 rounded transition"
        >
          {loading ? "Launching Campaign..." : "🚀 Launch Campaign!"}
        </button>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6 max-w-3xl mx-auto text-center">
      <h2 className="text-3xl font-bold text-amber-400">Your Campaign Has Launched</h2>

      <div className="bg-gray-950 border-2 border-amber-900/50 rounded-lg p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-900/5 to-transparent pointer-events-none" />
        <blockquote className="relative text-lg text-gray-200 italic leading-relaxed font-serif">
          {openingNarration || worldData?.opening_narration || "The adventure begins..."}
        </blockquote>
      </div>

      <p className="text-gray-400">
        Share your invite code with players, or enter the campaign now as the DM.
      </p>

      <button
        onClick={handleEnterCampaign}
        className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-4 px-8 rounded-lg text-lg transition shadow-lg shadow-amber-900/20"
      >
        Enter the Campaign →
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center gap-4">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition ${
                  step >= s ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-500"
                }`}
              >
                {s}
              </div>
              {s < 4 && (
                <div className={`w-12 h-0.5 transition ${step > s ? "bg-amber-600" : "bg-gray-800"}`} />
              )}
            </div>
          ))}
        </div>

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>
    </div>
  );
}
