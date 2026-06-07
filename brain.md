# brain.md — AI Multiplayer D&D Game: Final Draft Plan

> Zero-cost stack. No local models. No credit card required. Built for a private friend group of up to 10 players.

---

## Current Status

Last updated: 2026-06-07

- GitHub repo: `https://github.com/ironhammer2204-pixel/DND-Game`
- Supabase project: `fvgpsqksclhyvaeveaus` (`DND-Game`)
- `brain.md` is now the project source of truth and must be updated after every meaningful fix, feature, schema change, setup change, or architecture decision.
- Initial Supabase project files exist under `supabase/`.
- Initial remote migration `20260607123000_initial_game_schema.sql` has been pushed successfully.
- Database baseline includes the 12 core tables, indexes, update trigger, RLS enabled on all tables, and baseline private-campaign RLS policies.
- Starter item seed exists at `supabase/seed/001_item_catalog.sql`.
- Supabase config is aligned with the remote Postgres major version: `17`.
- Local `supabase db reset` has not been verified yet because Docker was not running locally.
- **Monorepo, Tooling, Phase 1 (Foundation) & Phase 2 Dice Engine are fully completed**:
  - Implemented portable Node.js (v22.12.0 LTS) under `.node/` to bypass system dependency constraints.
  - Initialized Turborepo monorepo with `apps/web`, `apps/server`, and `packages/shared` workspaces.
  - Set up base configurations for TypeScript, ESLint (v9 Flat Config), and Prettier.
  - Implemented types, schemas, and WS message definitions in `@dnd/shared/src/types`.
  - Implemented game constant mappings (races, classes, skills) in `@dnd/shared/src/constants`.
  - Created Express server with `cors`, `helmet`, and Supabase JWT verification middleware.
  - Added REST endpoints for User authentication, Campaign creation/joining, and Character sheet management.
  - Integrated Supabase DB client pool utilizing environment connection settings.
  - Implemented WebSocket Room Manager with room boundaries (max 10 players), connection tracking, and broadcast capabilities.
  - Built React/Vite/TS web application supporting registration/login, lobby campaign management, custom character creator, real-time log, attributes d20 rolling, and quick dice rollers.
  - Developed a cryptographically secure server-side dice engine (`diceEngine.ts`) utilizing `crypto.randomInt`.
  - Implemented a complete DicePanel UI on both DM and player screens featuring rolling buttons for all standard dice types (`d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100`) and a customizable numeric modifier input.
  - Hardened WebSocket campaign joins/reconnects so same-socket rejoins refresh character mapping without closing the live connection.
  - Added WebSocket recent event replay: joining/reconnecting clients receive the last 50 persisted campaign events.
  - Added authoritative `ACTION_SUBMIT` handling through `actionProcessor.ts`, including membership/character validation, `event_log` persistence, and room broadcast.
  - Completed campaign member/event REST endpoints: `GET /api/campaigns/:id/members` and `GET /api/campaigns/:id/events`.
  - Updated campaign detail responses to include members, made campaign join idempotent for existing members, and fixed character campaign route ordering.
  - Verified server/web TypeScript with no-emit checks and lint checks pass cleanly; full emit build is currently blocked locally by generated-output permission errors in `dist`, `node_modules/.tmp`, and Turbo logs.

---

## Stack

| Layer | Technology | Provider | Cost |
|---|---|---|---|
| Frontend | React + TypeScript + Tailwind CSS + Vite | Vercel (free) | $0 |
| Backend | Node.js + Express | Render.com (free, 750 hrs/mo) | $0 |
| Database | PostgreSQL | Supabase (free, 500MB) | $0 |
| Auth | Supabase Auth + JWT | Supabase | $0 |
| Realtime | WebSockets (ws library) + Supabase Realtime | Supabase | $0 |
| AI Dungeon Master | Llama 3.3 70B via Groq API | Groq (free tier) | $0 |
| Monorepo | Turborepo | — | $0 |
| **Total** | | | **$0/mo** |

### Free tier caveats

- **Render**: server sleeps after 15 min idle, ~30s cold start. For scheduled sessions this is irrelevant.
- **Supabase**: project pauses after 7 days of zero requests. One-click restore.
- **Groq**: 14,400 requests/day, 30 req/min. At 2 sessions/week with 10 players (~100 narration calls/session) you use ~2% of the daily limit.

---

## Core Principle

> **The AI is never the source of truth.**

The server is authoritative for all game state. The AI narrates outcomes — it never produces them.

| AI can | AI cannot |
|---|---|
| Narrate events | Modify player stats |
| Describe locations | Modify inventories or gold |
| Roleplay NPCs | Modify quest state |
| Generate dialogue | Generate or modify dice rolls |
| Suggest story developments | Modify combat outcomes |
| Create atmosphere | Write to the database (ever) |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│           CLIENT — React + TypeScript                │
│  GameView · CharSheet · Inventory · QuestLog         │
│  Chat · DicePanel · CombatUI · AI Narration Window  │
└────────────────┬────────────────────────────────────┘
                 │ HTTP + WebSocket
┌────────────────▼────────────────────────────────────┐
│         EXPRESS API GATEWAY (Render.com)             │
│         Auth middleware · Route dispatch             │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│         GAME SERVER — Node.js (authoritative)        │
│  ActionProcessor · DiceEngine · CombatEngine         │
│  QuestManager · WorldEngine · WS RoomManager         │
└──────┬──────────────────┬──────────────────┬────────┘
       │                  │                  │
┌──────▼──────┐  ┌────────▼──────┐  ┌───────▼───────┐
│ PostgreSQL  │  │  AI DM svc    │  │  WS Realtime  │
│ (Supabase) │  │  (Groq API)   │  │  (Supabase)   │
│             │  │  read-only    │  │               │
│  Source of  │  │  context only │  │  10-player    │
│  truth      │  │  narrates     │  │  rooms        │
└─────────────┘  └───────────────┘  └───────────────┘
```

**Order of operations for every game action:**
1. Client submits action (text or structured)
2. Server validates action against DB state
3. Server calculates outcome (dice, combat math, quest check)
4. Server writes result to DB
5. Server broadcasts `GAME_EVENT` to all players via WebSocket
6. Server enqueues async narration job → Groq API
7. AI narration arrives and is broadcast as display-only text

---

## Folder Structure

```
dnd-game/
├── apps/
│   ├── web/                          # React + Vite frontend (Single-file client shell in early phases)
│   │   └── src/
│   │       ├── assets/               # Static assets
│   │       ├── App.css               # Component specific styling
│   │       ├── App.tsx               # Main frontend codebase (All-in-one lobby/game shell)
│   │       ├── config.ts             # Client environment configuration
│   │       ├── index.css             # Main stylesheet & design system
│   │       └── main.tsx              # Application entry point
│   │
│   └── server/                       # Node.js + Express backend
│       └── src/
│           ├── db/
│           │   ├── client.ts         # pg pool → Supabase connection
│           │   └── supabase.ts       # Supabase service client
│           ├── game/
│           │   └── diceEngine.ts     # Cryptographically secure dice rolling utility
│           ├── middleware/
│           │   └── auth.ts           # Local JWT verification middleware
│           ├── routes/
│           │   ├── auth.ts           # Authentication REST endpoints
│           │   ├── campaigns.ts      # Campaign lobby & management REST endpoints
│           │   └── characters.ts     # Character spawning REST endpoints
│           ├── websocket/
│           │   ├── roomManager.ts    # WS campaign connection tracking
│           │   └── eventHandlers.ts  # WS message parsing & routing (calls diceEngine)
│           └── index.ts              # Server entry point (HTTP + WebSockets)
│
├── packages/
│   └── shared/                       # Shared type definitions & constants
│       └── src/
│           ├── constants/            # Game constants (races, classes, skills)
│           ├── types/                # TS Types (Character, Campaign, WS events)
│           └── index.ts              # Entry exporter
│
└── brain.md                          # Source of truth project spec
```

#### Target Folder Structure (Refactoring/Modularization Plan)
When the codebase is refactored in later phases, the folders will be modularized as follows:
```
dnd-game/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── components/           # Extracted UI components
│   │       │   ├── game/             # GameView, CombatInterface
│   │       │   ├── character/        # CharacterSheet, Inventory
│   │       │   ├── ui/               # Chat, DicePanel, QuestLog
│   │       │   └── layout/           # Sidebar, HUD
│   │       ├── hooks/                # useWebSocket, useCharacter, useCombat
│   │       ├── stores/               # Zustand: gameStore, uiStore
│   │       ├── pages/                # Lobby, Campaign, CharCreate, Auth
│   │       ├── services/             # api.ts, ws.ts
│   │       └── types/                # Shared TS types
│   │
│   └── server/
│       └── src/
│           ├── routes/
│           │   ├── auth.ts
│           │   ├── campaigns.ts
│           │   ├── characters.ts
│           │   ├── quests.ts
│           │   └── world.ts
│           ├── websocket/
│           │   ├── roomManager.ts
│           │   ├── eventHandlers.ts
│           │   └── events.ts
│           ├── game/
│           │   ├── actionProcessor.ts
│           │   ├── combatEngine.ts
│           │   ├── diceEngine.ts     # crypto.randomInt refactored logic
│           │   ├── questManager.ts
│           │   └── worldEngine.ts
│           ├── ai/
│           │   ├── dmService.ts
│           │   ├── contextBuilder.ts
│           │   └── promptTemplates.ts
│           ├── db/
│           │   ├── client.ts
│           │   ├── migrations/
│           │   └── queries/
│           └── middleware/
│               ├── auth.ts
│               └── validate.ts
```

---

## Database Schema (12 tables)

### `users`
```sql
id           uuid PRIMARY KEY DEFAULT gen_random_uuid()
email        text UNIQUE NOT NULL
username     text NOT NULL
avatar_url   text
created_at   timestamptz DEFAULT now()
```

### `campaigns`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
name          text NOT NULL
invite_code   text UNIQUE NOT NULL
owner_id      uuid REFERENCES users(id)
world_state   jsonb DEFAULT '{}'
session_count int DEFAULT 0
created_at    timestamptz DEFAULT now()
```

### `characters`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id       uuid REFERENCES users(id)
campaign_id   uuid REFERENCES campaigns(id)
name          text NOT NULL
race          text NOT NULL
class         text NOT NULL
level         int DEFAULT 1
xp            int DEFAULT 0
hp_current    int NOT NULL
hp_max        int NOT NULL
attributes    jsonb NOT NULL  -- { str, dex, con, int, wis, cha }
skills        jsonb NOT NULL
gold          int DEFAULT 0
reputation    jsonb DEFAULT '{}'
is_alive      bool DEFAULT true
updated_at    timestamptz DEFAULT now()
```

### `inventory_items`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
character_id  uuid REFERENCES characters(id)
item_id       uuid REFERENCES item_catalog(id)
quantity      int DEFAULT 1
is_equipped   bool DEFAULT false
acquired_at   timestamptz DEFAULT now()
```

### `npcs`
```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id       uuid REFERENCES campaigns(id)
name              text NOT NULL
role              text
location_id       uuid REFERENCES locations(id)
is_alive          bool DEFAULT true
relationship_map  jsonb DEFAULT '{}'   -- keyed by character_id
known_info        jsonb DEFAULT '[]'
memory_log        jsonb[] DEFAULT '{}'  -- array of interaction records
base_stats        jsonb NOT NULL
```

### `quests`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id   uuid REFERENCES campaigns(id)
type          text CHECK (type IN ('main', 'side', 'random'))
title         text NOT NULL
description   text
status        text DEFAULT 'active' CHECK (status IN ('active','complete','failed'))
objectives    jsonb[] NOT NULL   -- each: { text, completed: bool }
rewards       jsonb DEFAULT '{}'
giver_npc_id  uuid REFERENCES npcs(id)
created_at    timestamptz DEFAULT now()
completed_at  timestamptz
```

### `locations`
```sql
id                   uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id          uuid REFERENCES campaigns(id)
name                 text NOT NULL
type                 text   -- city, village, dungeon, wilderness
description          text
state                jsonb DEFAULT '{}'   -- { destroyed, discovered, controlled_by }
connected_locations  uuid[]
lore                 text
```

### `combat_encounters`
```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id         uuid REFERENCES campaigns(id)
status              text DEFAULT 'active' CHECK (status IN ('active','resolved'))
turn_order          jsonb[] NOT NULL   -- ordered initiative list
current_turn_index  int DEFAULT 0
participants        jsonb[] NOT NULL   -- { id, type, hp_current, hp_max, conditions }
round_number        int DEFAULT 1
started_at          timestamptz DEFAULT now()
```

### `event_log`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id   uuid REFERENCES campaigns(id)
type          text NOT NULL   -- combat, quest, chat, exploration, system
actor_id      uuid            -- character_id or npc_id
payload       jsonb NOT NULL  -- full structured event data
ai_narration  text            -- stored DM response (display only)
created_at    timestamptz DEFAULT now()
```

### `dice_rolls`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
character_id  uuid REFERENCES characters(id)
campaign_id   uuid REFERENCES campaigns(id)
dice_type     text NOT NULL   -- d4, d6, d8, d10, d12, d20, d100
raw_value     int NOT NULL
modifier      int DEFAULT 0
final_value   int NOT NULL
context       text            -- 'attack', 'damage', 'skill:perception', etc.
rolled_at     timestamptz DEFAULT now()
```

### `item_catalog`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
name          text NOT NULL
type          text            -- weapon, armor, consumable, misc
description   text
stats         jsonb DEFAULT '{}'  -- { damage, ac_bonus, range, etc. }
value_gp      int DEFAULT 0
is_consumable bool DEFAULT false
```

### `campaign_members`
```sql
campaign_id   uuid REFERENCES campaigns(id)
user_id       uuid REFERENCES users(id)
character_id  uuid REFERENCES characters(id)
role          text DEFAULT 'player' CHECK (role IN ('player', 'dm'))
joined_at     timestamptz DEFAULT now()
last_seen_at  timestamptz DEFAULT now()
PRIMARY KEY (campaign_id, user_id)
```

---

## WebSocket Events

### Client → Server
```
ACTION_SUBMIT      { type, payload }   -- player action text or structured
DICE_REQUEST       { dice_type, context, modifier }
CHAT_MESSAGE       { text }
JOIN_CAMPAIGN      { invite_code }
RECONNECT          { campaign_id, character_id }
COMBAT_ACTION      { action_type, target_id }
```

### Server → Client (broadcast)
```
GAME_EVENT         { type, payload, timestamp }
AI_NARRATION       { text, event_id }            -- display only
COMBAT_UPDATE      { encounter, turn_order, participants }
DICE_RESULT        { roller, dice_type, raw, modifier, final, context }
PLAYER_JOINED      { user, character }
PLAYER_LEFT        { user_id }
QUEST_UPDATE       { quest_id, status, objectives }
WORLD_UPDATE       { location_id, changes }
ERROR              { code, message }
```

---

## AI DM System

### Groq integration (dmService.ts)
```ts
import OpenAI from "openai";  // Groq is OpenAI-compatible

const groq = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

// Model: "llama-3.3-70b-versatile"
```

### Context snapshot sent to AI (read-only, never full DB)
```ts
{
  location: { name, description, lore },
  present_npcs: [{ name, role, relationship_to_party }],
  players: [{ name, race, class, level }],       // no stats, no inventory
  recent_events: event_log.slice(-10),           // last 10 events only
  active_quests: [{ title, current_objective }],
  game_result: { ... }                           // the outcome just calculated
}
```

### System prompt structure (promptTemplates.ts)
```
You are the Dungeon Master for a private D&D campaign.

CONTEXT (authoritative — do not contradict):
[structured JSON snapshot]

YOUR ROLE:
- Narrate what just happened in vivid prose
- Voice NPCs with personality consistent with their relationship values
- Build atmosphere and tension
- Advance the story

FORBIDDEN — never do these under any circumstances:
- Assign or mention specific XP values
- Modify or state HP values
- Declare quest objectives complete
- Invent items in a character's inventory
- State a die roll result before one is provided to you
- Kill or revive characters
- Contradict any fact in the context block above

Respond with 2–4 paragraphs of narration only. No meta-commentary.
```

---

## Hallucination Prevention — 6 Layers

1. **Structured context only.** AI receives a typed snapshot, not free-form conversation history. Every fact comes from a DB query.

2. **AI output is display-only.** There is no code path from `dmService.ts` response → DB write. Narration is stored as `event_log.ai_narration` (text column, never parsed).

3. **Server calculates first, AI narrates second.** The game engine commits results to DB and broadcasts to clients before the async narration job even starts.

4. **Explicit forbidden-actions block in every system prompt.** Non-negotiable — regenerated fresh on every call, never cached.

5. **Minimal context window.** Only the location, present NPCs, last 10 events, and active quests are sent. The AI cannot speculate about things it hasn't been told.

6. **Output filter before display.** A post-processing regex pass checks narration for patterns like "you gain X XP", "you take X damage", "the quest is complete" and strips or flags them before broadcasting. Defense in depth, not primary enforcement.

---

## Development Roadmap

> Tick every box before moving to the next phase. Each phase ends with something genuinely playable.

---

### Phase 1 — Foundation
**Goal: friends can join a room, create characters, and chat in real time**

#### Monorepo + tooling
- [x] Init Turborepo with `apps/web`, `apps/server`, `packages/shared`
- [x] Configure TypeScript in all three packages
- [x] Set up ESLint + Prettier across workspace
- [x] Add `packages/shared/src/types/` with Character, Campaign, User, Quest, Event types
- [x] Add `packages/shared/src/constants/` with Races, Classes, DiceTypes, Skills

#### Supabase setup
- [x] Create Supabase project (free tier)
- [x] Run migration: create all 12 tables (see schema section)
- [x] Enable Row Level Security on all tables
- [x] Write baseline RLS policies: users can only read/write their own campaign data
- [x] Enable Supabase Auth (email/password)
- [x] Test DB connection from server with `pg` pool

#### Express server (Render)
- [x] Init Express app with TypeScript
- [x] Add `cors`, `helmet`, `express-json` middleware
- [x] Add auth middleware (verify Supabase JWT)
- [x] Add `POST /api/auth/register` route
- [x] Add `POST /api/auth/login` route
- [x] Add `POST /api/auth/logout` route
- [x] Add WebSocket server (`ws` library) on same HTTP server
- [x] Confirm server deploys to Render free tier

#### WebSocket room manager
- [x] Create `roomManager.ts` — Map of campaignId → Set of WebSocket connections
- [x] Handle `JOIN_CAMPAIGN` event — add socket to room
- [x] Handle `disconnect` — remove socket, broadcast `PLAYER_LEFT`
- [x] Handle `RECONNECT` event — reattach socket to existing room
- [x] Enforce max 10 players per room
- [x] Broadcast helper: `broadcastToRoom(campaignId, event, payload)`

#### Campaign system
- [x] Add `POST /api/campaigns` — create campaign, generate 6-char invite code
- [x] Add `GET /api/campaigns/:id` — fetch campaign + members
- [x] Add `POST /api/campaigns/join` — join via invite code, insert into campaign_members
- [x] Add `GET /api/campaigns/:id/members` — list party

#### Character creation
- [x] Add `POST /api/characters` — create character, validate race/class/attributes
- [x] Add `GET /api/characters/:id` — fetch full character sheet
- [x] Auto-calculate HP max from class + CON modifier on creation
- [x] Auto-calculate skill modifiers from attributes on creation

#### Frontend — auth + lobby
- [x] Init React + Vite + TypeScript + Tailwind
- [x] Set up Zustand stores: `authStore`, `gameStore`, `uiStore`
- [x] Build Login page (email/password form → Supabase Auth)
- [x] Build Register page
- [x] Build Lobby page: create campaign or join via invite code
- [x] Build CharacterCreate page: pick race, class, name, roll/assign attributes
- [x] Protect routes — redirect to login if no session
- [x] Connect WebSocket on campaign join, store socket in `gameStore`

#### Frontend — game shell
- [x] Build main game layout: sidebar (party list) + center (narration/chat) + right panel (char sheet)
- [x] Build live chat component — send `CHAT_MESSAGE`, render `GAME_EVENT` of type chat
- [x] Build party list component — show name, class, level, online/offline status
- [x] Show `PLAYER_JOINED` / `PLAYER_LEFT` toast notifications
- [x] Persist auth session across page refresh

**Phase 1 done when:** Two people can open the app in different browsers, join the same campaign via invite code, see each other in the party list, and send chat messages in real time.

---

### Phase 2 — Game systems
**Goal: players can explore, roll dice, manage inventory, and track quests**

#### Dice engine
- [x] Build `diceEngine.ts` — `rollDice(type, modifier)` using `crypto.randomInt`
- [x] Add `DICE_REQUEST` WebSocket handler on server
- [x] Server rolls dice, writes result to `dice_rolls` table
- [x] Server broadcasts `DICE_RESULT` to all room members
- [x] Build DicePanel UI — buttons for d4/d6/d8/d10/d12/d20/d100
- [x] Show roll history in chat feed with roller name and context
- [x] Add modifier input to dice panel (+/- value before roll)

#### Action processor
- [x] Build `actionProcessor.ts` — receives raw action text, classifies it
- [x] Add `ACTION_SUBMIT` WebSocket handler
- [x] Validate action: is it the player's character? Are they in the campaign?
- [ ] Dispatch to correct subsystem (exploration, skill check, interact)
- [x] Write result to `event_log`
- [x] Broadcast `GAME_EVENT` to room

#### World system
- [ ] Seed starting world: 3 locations (town, dungeon entrance, wilderness)
- [ ] Add `GET /api/campaigns/:id/world` — return locations, connections, state
- [ ] Build location component — show name, description, present NPCs
- [ ] Allow movement between connected locations (server validates, updates character position in world_state)
- [ ] World state changes persist — if a location is "discovered", it stays discovered
- [ ] Add `WORLD_UPDATE` WebSocket broadcast on state change

#### Inventory system
- [ ] Seed item catalog (20 starter items: weapons, armor, potions, misc)
- [ ] Add `POST /api/characters/:id/inventory` — server adds item (never client-direct)
- [ ] Add `DELETE /api/characters/:id/inventory/:itemId` — drop item
- [ ] Add `PATCH /api/characters/:id/inventory/:itemId/equip` — toggle equipped
- [ ] Build Inventory panel UI — grid of items, equip/drop buttons
- [ ] Show equipped items on character sheet with stat bonuses applied
- [ ] Gold transactions — server-only, logged in event_log

#### Quest system
- [ ] Add `POST /api/campaigns/:id/quests` — create quest (server/DM only)
- [ ] Add `GET /api/campaigns/:id/quests` — list active + completed quests
- [ ] Add `PATCH /api/campaigns/:id/quests/:id/objective` — mark objective complete (server only)
- [ ] Build QuestLog UI — active quests, objectives with checkmarks, completed section
- [ ] Add `QUEST_UPDATE` WebSocket broadcast on any quest change
- [ ] Seed 3 starter quests for new campaigns

#### Character sheet
- [ ] Build full CharacterSheet panel: attributes, skills, HP, gold, equipment
- [ ] Show derived stats: AC (from equipped armor), attack bonus, spell save DC
- [ ] Add level-up logic: XP threshold check, HP increase, stat point allocation
- [ ] Skill check roll button on each skill (auto-rolls d20 + skill modifier)
- [ ] Character sheet updates live via `GAME_EVENT` broadcast

#### Event log UI
- [x] Build scrolling event log — shows all game events in chronological order
- [x] Colour-code by event type: combat (red), quest (gold), chat (white), system (grey)
- [x] Load last 50 events on join (catch-up for reconnects)

**Phase 2 done when:** Players can move between locations, roll dice with modifiers, pick up items, equip gear, see quests in a log, and all of it persists across page reloads.

---

### Phase 3 — AI + combat
**Goal: full sessions with AI narration, turn-based combat, and living NPCs**

#### Combat engine
- [ ] Build `combatEngine.ts` with full turn-based logic
- [ ] Initiative roll: d20 + DEX modifier for each participant, sorted descending
- [ ] Attack roll: d20 + attack bonus vs target AC — hit or miss
- [ ] Damage roll: weapon damage dice + STR/DEX modifier on hit
- [ ] Apply damage to target HP in DB, check for death (HP ≤ 0)
- [ ] Death saves: d20 on downed character's turn, 3 successes = stable, 3 fails = dead
- [ ] Conditions: poisoned, stunned, paralysed — store in participant jsonb, apply mechanical effects
- [ ] Enemy AI turn logic (code-based): pick nearest player, roll attack, apply damage
- [ ] Handle end of combat: XP distribution, loot generation (server calculates)
- [ ] Add `COMBAT_ACTION` WebSocket handler — validate it's actor's turn, execute, broadcast `COMBAT_UPDATE`
- [ ] Build CombatInterface UI: turn order tracker, HP bars, action buttons (attack, dodge, use item)
- [ ] Show dice rolls animated in UI during combat

#### NPC system
- [ ] Seed 5 NPCs for starter world (merchant, guard, quest giver, villain, neutral)
- [ ] NPC relationship values update on player interaction (server writes to `npcs.relationship_map`)
- [ ] NPC memory log: append interaction record on every significant event
- [ ] NPCs stay dead permanently if killed (is_alive = false, never resets)
- [ ] `GET /api/campaigns/:id/npcs` — fetch NPCs at current location

#### Context builder
- [ ] Build `contextBuilder.ts` — assembles read-only snapshot before every AI call
- [ ] Fetch current location row
- [ ] Fetch NPCs at current location with relationship values for present players
- [ ] Fetch last 10 event_log entries
- [ ] Fetch active quest list (titles + current objective only)
- [ ] Include the just-calculated game result (combat outcome, skill check, etc.)
- [ ] Cap total context at ~1500 tokens — trim oldest events if over limit

#### Groq narration pipeline
- [ ] Build `dmService.ts` — calls Groq API with assembled context
- [ ] System prompt includes forbidden-actions block (see AI section)
- [ ] Stream response back to server as it arrives
- [ ] Broadcast `AI_NARRATION` chunks to room via WebSocket (streaming feel)
- [ ] Store completed narration in `event_log.ai_narration`
- [ ] Add output filter — strip any narration containing HP values, XP numbers, quest completion declarations
- [ ] Queue narration jobs async — never block game state broadcast waiting for AI

#### Procedural quest generation
- [ ] Build quest generator: pick random template (fetch, kill, escort, find), fill with world NPCs and locations
- [ ] Server can auto-generate a quest when party enters a new location with no active quests
- [ ] Generated quests go through same DB + broadcast flow as hand-authored quests

**Phase 3 done when:** The party can get into a fight, take turns attacking enemies, see HP bars change in real time, watch the AI DM narrate the outcome afterwards, and carry NPC relationship history across sessions.

---

### Phase 4 — Polish
**Goal: something you'd actually want to show a friend**

#### UI polish
- [ ] Mobile-responsive layout pass (game works on phone)
- [ ] Loading states on all async actions
- [ ] Error handling: toast notifications for server errors, disconnects, validation failures
- [ ] Reconnect banner: "Reconnecting..." shown when WS drops, auto-reconnects
- [ ] Smooth HP bar transitions in combat
- [ ] Dice roll animation (CSS spin before showing result)
- [ ] Typing indicator when AI DM is generating narration

#### World encyclopedia
- [ ] Build encyclopedia page: browsable list of discovered locations, known NPCs, factions
- [ ] Entries only appear after player has visited/met them (fog of war)
- [ ] NPC entries show relationship status and known interaction history

#### Session history
- [ ] Build session log page: scrollable full history of all events and narration
- [ ] Filter by event type
- [ ] "Share session recap" — generates plain text summary of the session

#### Balancing
- [ ] XP per enemy type balanced to level 1→5 in ~10 sessions
- [ ] Starting gold and item prices tuned for early game
- [ ] Enemy HP and damage values playtested at level 1, 3, 5
- [ ] Encounter rate: random combat trigger on wilderness movement (~30% chance)

#### Production deploy
- [ ] Configure Render deploy (set all env vars, health check endpoint)
- [ ] Configure Vercel deploy (set VITE_ env vars, production build)
- [ ] Set up Supabase production project (separate from dev)
- [ ] Smoke test: full session from register → campaign → combat → AI narration on production URLs
- [ ] Write one-page setup guide for invite link sharing

**Phase 4 done when:** You can send a friend an invite link, they sign up, join your campaign, play a session with combat and AI narration, and it feels like a real game — not a prototype.

---

## API Routes

```
// === Implemented REST Endpoints ===
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout

POST   /api/campaigns                    # create campaign
GET    /api/campaigns                    # list campaigns user belongs to
POST   /api/campaigns/join               # join via invite code
GET    /api/campaigns/:id                # get campaign details
GET    /api/campaigns/:id/members        # list campaign members and linked characters
GET    /api/campaigns/:id/events         # recent event log catch-up

POST   /api/characters                   # create character
GET    /api/characters/:id               # retrieve character details
GET    /api/characters/campaign/:campaignId # list campaign characters

// === Planned REST Endpoints (Phase 2 & 3) ===
PATCH  /api/characters/:id               # server-only mutations

GET    /api/campaigns/:id/quests
GET    /api/campaigns/:id/quests/:questId
GET    /api/campaigns/:id/world          # locations, factions, NPCs
```

All mutation endpoints require auth middleware. Character stat updates are server-internal only — no public PATCH route for HP, gold, or inventory.

---

## Environment Variables

### Server (.env)
```
DATABASE_URL=postgresql://...          # Supabase connection string
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=...               # server-side only
JWT_SECRET=...
GROQ_API_KEY=...                       # from console.groq.com (free)
PORT=3001
NODE_ENV=production
```

### Client (.env)
```
VITE_API_URL=https://your-app.onrender.com
VITE_WS_URL=wss://your-app.onrender.com
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

---

## Key Design Decisions

**Why Groq over Ollama/local models?** The constraint is zero cost and no local downloads. Groq's free tier is the only option that satisfies both. The rate limits are well above what a friend group needs.

**Why WebSockets over Supabase Realtime for game events?** Supabase Realtime is built on Postgres changes — excellent for data sync but adds latency and complexity for bidirectional game events. A ws library on the Express server gives full control over room logic, reconnect handling, and event ordering. Supabase Realtime can optionally be used as a fallback.

**Why Turborepo?** The `@dnd/shared` package lets the frontend import the exact same TypeScript types as the server. Prevents type drift between client and server models — a common source of bugs in multiplayer games.

**Why jsonb for attributes/skills/stats?** D&D has many optional systems (feats, spell slots, class features). Jsonb avoids constant migration churn as game content expands. Core game logic uses known keys; the rest is flexible.

**Why store AI narration in event_log?** Session replay, party members who reconnected mid-session, and the world encyclopedia all benefit from a persistent narration history. It also makes debugging AI output easy.

---

*brain.md — last updated: 2026-06-07 websocket/campaign/action update*
