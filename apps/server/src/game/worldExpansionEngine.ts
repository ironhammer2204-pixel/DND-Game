/**
 * worldExpansionEngine.ts
 *
 * AI-powered world expansion for campaign creation.
 * Synchronous Groq call (DM is waiting). Falls back to deterministic seed-based generation.
 */

import { Pool, PoolClient } from "pg";
import OpenAI from "openai";

// Groq client (reuse dmService pattern)
let groqClient: OpenAI | null = null;

function getGroqClient(): OpenAI {
  if (!groqClient) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY not set");
    }
    groqClient = new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groqClient;
}

const GROQ_MODEL = "llama-3.3-70b-versatile";

const VALID_FACTION_TYPES = new Set([
  "empire", "merchant", "cult", "rebel", "criminal", "secret", "neutral",
]);

function mapFactionType(rawType: string): string {
  const lower = rawType.toLowerCase();
  if (VALID_FACTION_TYPES.has(lower)) return lower;
  if (lower.includes("cult") || lower.includes("religious") || lower.includes("church")) return "cult";
  if (lower.includes("merchant") || lower.includes("trade") || lower.includes("guild")) return "merchant";
  if (lower.includes("criminal") || lower.includes("syndicate") || lower.includes("thief")) return "criminal";
  if (lower.includes("rebel") || lower.includes("resistance")) return "rebel";
  if (lower.includes("empire") || lower.includes("kingdom") || lower.includes("army")) return "empire";
  if (lower.includes("secret")) return "secret";
  return "neutral";
}

function mapDisposition(alignment?: string): string {
  const lower = (alignment || "").toLowerCase();
  if (lower.includes("hostile") || lower.includes("evil")) return "hostile";
  if (lower.includes("allied") || lower.includes("good")) return "allied";
  if (lower.includes("rival")) return "rival";
  return "neutral";
}

// ============================================================
// TYPES
// ============================================================

export interface WorldExpansionInput {
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

export interface WorldExpansionResult {
  world_summary: string;
  opening_narration: string;
  locations: Array<{
    name: string;
    type: "city" | "dungeon" | "wilderness" | "settlement" | "ruin" | "fortress" | "port" | "temple";
    description: string;
    lore: string;
    state: {
      law: "strict" | "moderate" | "lax" | "anarchy";
      tax_percent: number;
      patrol_level: "heavy" | "moderate" | "light" | "none";
      danger_level: "safe" | "low" | "medium" | "high" | "deadly";
    };
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
    agenda_state: {
      current_step: number;
      ticks_at_current_step: number;
      last_action: string | null;
      blocked_reason: string | null;
    };
    base_stats: { fear: number; ambition: number };
    short_term_goal: string;
    long_term_goal: string;
    initial_relationship: number;
  }>;
  factions: Array<{
    name: string;
    type: string;
    description: string;
    alignment: string;
    military: number;
    wealth: number;
    influence: number;
    is_hidden: boolean;
    primary_location_name: string;
  }>;
  quests: Array<{
    title: string;
    type: "main" | "side";
    description: string;
    hook: string;
    objectives: Array<{ text: string; completed: boolean }>;
    current_objective: string;
    giver_npc_name?: string;
    rewards: { gold?: number; xp?: number; item?: string };
  }>;
  random_event_seeds: string[];
  nemesis_seed?: {
    name: string;
    tier: "soldier" | "lieutenant";
    personality_preset: "cunning" | "honorable" | "vengeful" | "warlord" | "paranoid";
    connection_to_hook: string;
  };
}

// ============================================================
// AI PROMPT BUILDER
// ============================================================

function buildWorldPrompt(input: WorldExpansionInput): { system: string; user: string } {
  const system = `You are a world-building assistant for a D&D campaign. Your sole task is to generate structured world data as valid JSON. You must respond with ONLY a single JSON object — no markdown, no explanation, no code fences. The JSON must be valid and parseable. Do not include comments. Do not wrap in backticks.`;

  const user = `Generate a complete starter world for a D&D campaign with the following parameters:

CAMPAIGN PREMISE:
- Tone: ${input.tone}
- Setting: ${input.setting}
- Hook: ${input.hook}
- Themes: ${input.themes.join(", ")}
- Party size: ${input.party_size} players
- Starting level: ${input.starting_level}
- Difficulty: ${input.difficulty}
${input.known_npcs ? `- Creator wants these NPCs: ${input.known_npcs.join(", ")}` : ""}
${input.known_locations ? `- Creator wants these locations: ${input.known_locations.join(", ")}` : ""}
${input.villain_archetype ? `- Villain archetype: ${input.villain_archetype}` : ""}
${input.session_zero_notes ? `- Additional notes: ${input.session_zero_notes}` : ""}

Generate a world with:
- 1 world_summary (string, 150 words)
- 1 opening_narration (string, 80 words, second-person plural, read-aloud style)
- 4-7 locations (include one marked is_starting_location: true)
- 3-6 NPCs distributed across the locations
- 2-4 factions
- 1 main quest + 2-3 side quests
- 5-8 random_event_seeds (one-sentence world events that could occur during play)
- 1 nemesis_seed (optional, include only if the hook warrants a recurring villain)

All location names and NPC location_names must be consistent (NPCs must reference actual location names you generate).
Quest giver_npc_names must reference actual NPC names you generate.

Return the JSON object exactly matching this TypeScript interface:

{
  "world_summary": string,
  "opening_narration": string,
  "locations": [{ "name": string, "type": string, "description": string, "lore": string, "state": { "law": string, "tax_percent": number, "patrol_level": string, "danger_level": string }, "connected_location_names": string[], "is_starting_location": boolean }],
  "npcs": [{ "name": string, "archetype": string, "role": string, "location_name": string, "short_description": string, "secret": string, "agenda_state": { "current_step": 0, "ticks_at_current_step": 0, "last_action": null, "blocked_reason": null }, "base_stats": { "fear": number, "ambition": number }, "short_term_goal": string, "long_term_goal": string, "initial_relationship": number }],
  "factions": [{ "name": string, "type": string, "description": string, "alignment": string, "military": number, "wealth": number, "influence": number, "is_hidden": boolean, "primary_location_name": string }],
  "quests": [{ "title": string, "type": string, "description": string, "hook": string, "objectives": [{ "text": string, "completed": false }], "current_objective": string, "giver_npc_name": string, "rewards": { "gold": number, "xp": number } }],
  "random_event_seeds": string[],
  "nemesis_seed": { "name": string, "tier": string, "personality_preset": string, "connection_to_hook": string }
}`;

  return { system, user };
}

// ============================================================
// FALLBACK WORLD GENERATOR (deterministic, no AI needed)
// ============================================================

function generateFallbackWorld(input: WorldExpansionInput): WorldExpansionResult {
  const tone = input.tone;
  const setting = input.setting || "an unnamed frontier";
  const hook = input.hook || "a mysterious threat looms";

  const summaries: Record<string, string> = {
    dark: `In the shadowed realm of ${setting}, hope is a dying ember. The land bears scars of old wars, and ${hook} has drawn the desperate and the damned alike. Every road leads to ruin, yet the brave still walk them.`,
    heroic: `The realm of ${setting} stands at a crossroads of destiny. ${hook} threatens all who call it home, but heroes rise from the most unlikely places. Glory awaits those bold enough to seize it.`,
    mystery: `Fog clings to ${setting} like a secret refusing to be told. ${hook} is merely the first thread in a tapestry of deception. Every answer births three new questions, and the truth hides behind friendly smiles.`,
    political: `The courts of ${setting} are a battlefield of whispers and daggers. ${hook} has upset the delicate balance of power, and factions move like chess pieces in a game where the board is soaked in blood.`,
    horror: `Something ancient and hungry stirs beneath ${setting}. ${hook} is but a symptom of a deeper rot. The land itself seems to recoil from what walks its roads after dark.`,
  };

  const narrations: Record<string, string> = {
    dark: `You stand at the edge of all you have known, and it burns. The wind carries ash and the screams of the dying. Ahead lies only darkness, but turning back is no longer a choice you have.`,
    heroic: `The call has come, clear and undeniable. Destiny does not wait for the ready — it takes the willing. You stand at the threshold of legend, and the world holds its breath.`,
    mystery: `A letter arrives with no sender, bearing only a symbol you recognize from childhood nightmares. The tavern keeper will not meet your eyes. The door you seek is already open.`,
    political: `The invitation was delivered by a masked courier at midnight. Power shifts like sand beneath your feet, and every ally is a blade that may turn. Trust is the first casualty of ambition.`,
    horror: `You wake to find the door you barred from within now stands open. The candle has burned to a stub, and in the wax, shapes form that you do not remember carving. It knows you are here.`,
  };

  const locations = [
    {
      name: "The Last Hearth",
      type: "settlement" as const,
      description: "A weary frontier town clinging to existence at the edge of the wilds.",
      lore: "Founded by refugees, it has survived every siege by being too poor to be worth conquering.",
      state: { law: "moderate" as const, tax_percent: 10, patrol_level: "light" as const, danger_level: "medium" as const },
      connected_location_names: ["The Whispering Woods", "The Broken Spire"],
      is_starting_location: true,
    },
    {
      name: "The Whispering Woods",
      type: "wilderness" as const,
      description: "Ancient pines where the wind carries voices that are not quite human.",
      lore: "Travelers who spend the night here sometimes wake with new memories that are not their own.",
      state: { law: "anarchy" as const, tax_percent: 0, patrol_level: "none" as const, danger_level: "high" as const },
      connected_location_names: ["The Last Hearth", "The Sunken Temple"],
      is_starting_location: false,
    },
    {
      name: "The Broken Spire",
      type: "ruin" as const,
      description: "A collapsed wizard's tower, its basement still humming with residual magic.",
      lore: "The wizard who lived here tried to bind a god. The spire fell. The binding did not.",
      state: { law: "anarchy" as const, tax_percent: 0, patrol_level: "none" as const, danger_level: "deadly" as const },
      connected_location_names: ["The Last Hearth"],
      is_starting_location: false,
    },
    {
      name: "The Sunken Temple",
      type: "temple" as const,
      description: "Half-submerged in a misty lake, its bells still ring underwater.",
      lore: "The priests drowned themselves to keep a secret. The secret is still here.",
      state: { law: "strict" as const, tax_percent: 20, patrol_level: "heavy" as const, danger_level: "medium" as const },
      connected_location_names: ["The Whispering Woods"],
      is_starting_location: false,
    },
  ];

  const npcs = [
    {
      name: "Elara Vane",
      archetype: "innkeeper",
      role: "Proprietor of The Last Hearth tavern",
      location_name: "The Last Hearth",
      short_description: "A sharp-eyed woman who hears everything and forgets nothing.",
      secret: "She is a former spy for a fallen kingdom, still feeding information to ghosts.",
      agenda_state: { current_step: 0, ticks_at_current_step: 0, last_action: null, blocked_reason: null },
      base_stats: { fear: 40, ambition: 60 },
      short_term_goal: "Keep the tavern running and the patrons safe",
      long_term_goal: "Reclaim her family's lost honor",
      initial_relationship: 10,
    },
    {
      name: "Brother Malach",
      archetype: "cleric",
      role: "Wandering healer and doom-sayer",
      location_name: "The Last Hearth",
      short_description: "A gaunt man in threadbare robes who speaks in riddles that always come true.",
      secret: "He caused the catastrophe he warns against. He seeks redemption through prophecy.",
      agenda_state: { current_step: 0, ticks_at_current_step: 0, last_action: null, blocked_reason: null },
      base_stats: { fear: 70, ambition: 30 },
      short_term_goal: "Find someone worthy to bear the truth",
      long_term_goal: "Atone for the sin that broke the world",
      initial_relationship: 0,
    },
    {
      name: "Kael Thornwood",
      archetype: "warrior",
      role: "Disgraced captain of the guard",
      location_name: "The Whispering Woods",
      short_description: "A scarred veteran who lives in self-imposed exile, hunting the things that emerge from the dark.",
      secret: "He was ordered to burn his own village. He obeyed. Now he hunts his former commanders.",
      agenda_state: { current_step: 0, ticks_at_current_step: 0, last_action: null, blocked_reason: null },
      base_stats: { fear: 20, ambition: 80 },
      short_term_goal: "Survive the woods and kill the creatures that stalk him",
      long_term_goal: "Destroy the military hierarchy that made him a monster",
      initial_relationship: -10,
    },
  ];

  const factions = [
    {
      name: "The Ashen Covenant",
      type: "religious order",
      description: "A secretive cult that believes destruction is the only path to renewal.",
      alignment: "lawful evil",
      military: 60,
      wealth: 40,
      influence: 70,
      is_hidden: true,
      primary_location_name: "The Sunken Temple",
    },
    {
      name: "The Iron Merchants",
      type: "trade guild",
      description: "A pragmatic consortium that profits from chaos and sells to all sides.",
      alignment: "neutral",
      military: 30,
      wealth: 80,
      influence: 50,
      is_hidden: false,
      primary_location_name: "The Last Hearth",
    },
  ];

  const quests = [
    {
      title: "The Hearth's Edge",
      type: "main" as const,
      description: "Something is drawing the dangers of the wilds toward The Last Hearth. Find the source before the settlement falls.",
      hook: "Brother Malach has a vision of the town burning. He begs you to investigate the woods.",
      objectives: [{ text: "Investigate the Whispering Woods", completed: false }, { text: "Discover what draws the creatures", completed: false }, { text: "Stop the source of the threat", completed: false }],
      current_objective: "Investigate the Whispering Woods",
      giver_npc_name: "Brother Malach",
      rewards: { gold: 150, xp: 300 },
    },
    {
      title: "The Spire's Secret",
      type: "side" as const,
      description: "The Broken Spire still hums with power. Someone wants what sleeps inside.",
      hook: "Elara Vane overheard strangers asking about the spire. She fears what they might unleash.",
      objectives: [{ text: "Reach the Broken Spire", completed: false }, { text: "Determine who seeks its power", completed: false }],
      current_objective: "Reach the Broken Spire",
      giver_npc_name: "Elara Vane",
      rewards: { gold: 75, xp: 150 },
    },
  ];

  return {
    world_summary: summaries[tone] || summaries.dark,
    opening_narration: narrations[tone] || narrations.dark,
    locations,
    npcs,
    factions,
    quests,
    random_event_seeds: [
      "A traveling merchant arrives with goods from a city that no longer exists.",
      "The well water turns black for one hour at midnight.",
      "A child claims to have spoken with someone who died ten years ago.",
      "All the birds in the region fall silent for an entire day.",
      "A stranger arrives wearing the face of someone the party knows.",
    ],
    nemesis_seed: {
      name: "The Hollow Man",
      tier: "lieutenant",
      personality_preset: "cunning",
      connection_to_hook: "He is the one who set the current catastrophe in motion, and he watches the players to see if they are worthy pawns.",
    },
  };
}

// ============================================================
// AI CALL
// ============================================================

export async function expandWorldWithAI(
  input: WorldExpansionInput
): Promise<WorldExpansionResult> {
  if (!process.env.GROQ_API_KEY) {
    console.warn("[worldExpansionEngine] No GROQ_API_KEY — using fallback world");
    return generateFallbackWorld(input);
  }

  const client = getGroqClient();
  const { system, user } = buildWorldPrompt(input);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const completion = await client.chat.completions.create(
      {
        model: GROQ_MODEL,
        temperature: 0.85,
        max_tokens: 4000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      { signal: controller.signal }
    );

    const content = completion.choices[0]?.message?.content?.trim() || "";
    if (!content) {
      throw new Error("Empty AI response");
    }

    // Strip markdown fences if present
    const cleaned = content.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
    const parsed: WorldExpansionResult = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.locations?.length || !parsed.npcs?.length || !parsed.quests?.length) {
      throw new Error("AI response missing required arrays");
    }

    return parsed;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn("[worldExpansionEngine] Groq timeout — using fallback world");
    } else {
      console.error("[worldExpansionEngine] AI expansion failed:", err.message);
    }
    return generateFallbackWorld(input);
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// PERSISTENCE
// ============================================================

export async function persistWorldExpansion(
  client: PoolClient | Pool,
  campaignId: string,
  result: WorldExpansionResult,
  input?: Pick<WorldExpansionInput, "tone" | "difficulty" | "starting_level">,
): Promise<{
  locationIds: Record<string, string>;
  npcIds: Record<string, string>;
  factionIds: Record<string, string>;
  questIds: Record<string, string>;
}> {
  const locationIds: Record<string, string> = {};
  const npcIds: Record<string, string> = {};
  const factionIds: Record<string, string> = {};
  const questIds: Record<string, string> = {};

  await client.query("BEGIN");

  try {
    // 1. Insert locations
    for (const loc of result.locations) {
      const locRes = await client.query(
        `INSERT INTO public.locations (campaign_id, name, type, description, lore, state, danger_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          campaignId,
          loc.name,
          loc.type,
          loc.description,
          loc.lore,
          JSON.stringify({
            ...loc.state,
            discovered: loc.is_starting_location,
            is_starting_location: loc.is_starting_location,
          }),
          loc.state.danger_level,
        ]
      );
      locationIds[loc.name] = locRes.rows[0].id;
    }

    // 2. Resolve connections
    for (const loc of result.locations) {
      const fromId = locationIds[loc.name];
      const toIds = loc.connected_location_names
        .map((n) => locationIds[n])
        .filter(Boolean);
      if (toIds.length > 0) {
        await client.query(
          "UPDATE public.locations SET connected_locations = $1::uuid[] WHERE id = $2",
          [toIds, fromId],
        );
      }
    }

    // 3. Insert NPCs
    for (const npc of result.npcs) {
      const locId = locationIds[npc.location_name];
      const npcRes = await client.query(
        `INSERT INTO public.npcs (campaign_id, name, role, archetype, location_id, is_alive, relationship_map, base_stats, agenda_state, secret, short_term_goal, long_term_goal)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          campaignId,
          npc.name,
          npc.role,
          npc.archetype,
          locId || null,
          JSON.stringify({}),
          JSON.stringify(npc.base_stats),
          JSON.stringify(npc.agenda_state),
          npc.secret,
          npc.short_term_goal,
          npc.long_term_goal,
        ],
      );
      npcIds[npc.name] = npcRes.rows[0].id;
    }

    // 4. Insert factions
    for (const fac of result.factions) {
      const locId = locationIds[fac.primary_location_name];
      const facRes = await client.query(
        `INSERT INTO public.factions
         (campaign_id, name, type, personality, disposition, power_level, description, is_hidden, military, wealth, influence, stability, pressure, pressure_cap, objectives, victory_condition, is_victorious, collapsed)
         VALUES ($1, $2, $3, 'expansionist', $4, $5, $6, $7, $8, $9, $10, 80, 0, 1000, '[]'::jsonb, '{}'::jsonb, false, false)
         RETURNING id`,
        [
          campaignId,
          fac.name,
          mapFactionType(fac.type),
          mapDisposition(fac.alignment),
          Math.max(1, Math.floor((fac.military + fac.influence) / 10)),
          fac.description,
          fac.is_hidden,
          fac.military,
          fac.wealth,
          fac.influence,
        ],
      );
      factionIds[fac.name] = facRes.rows[0].id;
    }

    // 5. Insert quests
    for (const quest of result.quests) {
      const giverId = quest.giver_npc_name ? npcIds[quest.giver_npc_name] : null;
      const questRes = await client.query(
        `INSERT INTO public.quests (campaign_id, type, title, description, objectives, rewards, status, current_objective, giver_npc_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
         RETURNING id`,
        [
          campaignId,
          quest.type,
          quest.title,
          quest.description,
          JSON.stringify(quest.objectives),
          JSON.stringify(quest.rewards),
          quest.current_objective,
          giverId,
        ]
      );
      questIds[quest.title] = questRes.rows[0].id;
    }

    // 6. Update campaign world_state
    const startingLoc = result.locations.find((l) => l.is_starting_location);
    const startingLocId = startingLoc ? locationIds[startingLoc.name] : null;

    const settingsRes = await client.query(
      "SELECT settings FROM public.campaigns WHERE id = $1",
      [campaignId],
    );
    const existingSettings = settingsRes.rows[0]?.settings || {};

    await client.query(
      `UPDATE public.campaigns
       SET world_state = COALESCE(world_state, '{}'::jsonb) || $1::jsonb,
           current_location_id = COALESCE($2, current_location_id),
           settings = COALESCE(settings, '{}'::jsonb) || $3::jsonb
       WHERE id = $4`,
      [
        JSON.stringify({
          world_summary: result.world_summary,
          opening_narration: result.opening_narration,
          random_event_seeds: result.random_event_seeds,
          expansion_at: new Date().toISOString(),
          discovered_location_ids: startingLocId ? [startingLocId] : [],
          current_location_id: startingLocId,
          character_locations: {},
        }),
        startingLocId,
        JSON.stringify({
          tone: input?.tone ?? existingSettings.tone,
          difficulty: input?.difficulty ?? existingSettings.difficulty,
          starting_level: input?.starting_level ?? existingSettings.starting_level,
        }),
        campaignId,
      ],
    );

    await client.query("COMMIT");

    return { locationIds, npcIds, factionIds, questIds };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export async function regenerateElement(
  client: PoolClient | Pool,
  campaignId: string,
  elementType: "location" | "npc" | "faction" | "quest" | "nemesis",
  elementIndex: number,
  input: WorldExpansionInput
): Promise<any> {
  // For regeneration, we call AI with a focused prompt for just one element
  // For simplicity, return a fallback element based on type
  const fallback = generateFallbackWorld(input);

  switch (elementType) {
    case "location":
      return fallback.locations[elementIndex % fallback.locations.length];
    case "npc":
      return fallback.npcs[elementIndex % fallback.npcs.length];
    case "faction":
      return fallback.factions[elementIndex % fallback.factions.length];
    case "quest":
      return fallback.quests[elementIndex % fallback.quests.length];
    case "nemesis":
      return fallback.nemesis_seed;
    default:
      return null;
  }
}
