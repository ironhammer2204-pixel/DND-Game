# brain.md â€” AI Multiplayer D&D Game: Final Draft Plan

> Zero-cost stack. No local models. No credit card required. Built for a private friend group of up to 10 players.

---

## Current Status

Last updated: 2026-06-07 (comprehensive audit completed)

- GitHub repo: `https://github.com/ironhammer2204-pixel/DND-Game`
- Supabase project: `fvgpsqksclhyvaeveaus` (`DND-Game`)
- `brain.md` is now the project source of truth and must be updated after every meaningful fix, feature, schema change, setup change, or architecture decision.
- Initial Supabase project files exist under `supabase/`.
- Initial remote migration `20260607123000_initial_game_schema.sql` has been pushed successfully.
- Database baseline includes the 12 core tables, indexes, update trigger, RLS enabled on all tables, and baseline private-campaign RLS policies.
- Starter item seed exists at `supabase/seed/001_item_catalog.sql`.
- Supabase config is aligned with the remote Postgres major version: `17`.
- Local `supabase db reset` has not been verified yet because Docker was not running locally.
- **Phase 1 (Foundation): FULLY COMPLETE** — all 8 checkboxes implemented and tested
- **Phase 2 (Game systems): PARTIALLY COMPLETE (~65%)**
  - Complete: Dice engine, Action processor (with skill checks), World system (server-side), Inventory system, Event log UI
  - Character sheet is partially complete: attributes, skills, HP, gold, equipped items, AC, attack bonus, and spell save DC are displayed
  - Still pending: location UI, gold transaction ledger, level-up logic
- Recent fixes:
  - Fixed action processor to properly dispatch skill check actions (rolls d20 + skill modifier)
  - Added skills display to character sheet UI
  - Added inventory REST endpoints, 20 starter item seeds, starter gear, equip/drop UI, and derived AC from equipped armor/shields
  - Added quest REST endpoints, starter quests, QuestLog UI, `QUEST_UPDATE` broadcasts, and DM objective toggles
  - Added character-sheet attack bonus, spell save DC, and skill roll buttons
  - Preserved Phase 3 Living World and Emergent Class architecture notes from the remote branch

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
| Monorepo | Turborepo | â€” | $0 |
| **Total** | | | **$0/mo** |

### Free tier caveats

- **Render**: server sleeps after 15 min idle, ~30s cold start. For scheduled sessions this is irrelevant.
- **Supabase**: project pauses after 7 days of zero requests. One-click restore.
- **Groq**: 14,400 requests/day, 30 req/min. At 2 sessions/week with 10 players (~100 narration calls/session) you use ~2% of the daily limit.

---

## Core Principle

> **The AI is never the source of truth.**

The server is authoritative for all game state. The AI narrates outcomes â€” it never produces them.

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
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚           CLIENT â€” React + TypeScript                â”‚
â”‚  GameView Â· CharSheet Â· Inventory Â· QuestLog         â”‚
â”‚  Chat Â· DicePanel Â· CombatUI Â· AI Narration Window  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                 â”‚ HTTP + WebSocket
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚         EXPRESS API GATEWAY (Render.com)             â”‚
â”‚         Auth middleware Â· Route dispatch             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                 â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚         GAME SERVER â€” Node.js (authoritative)        â”‚
â”‚  ActionProcessor Â· DiceEngine Â· CombatEngine         â”‚
â”‚  QuestManager Â· WorldEngine Â· WS RoomManager         â”‚
â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜
       â”‚                  â”‚                  â”‚
â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
â”‚ PostgreSQL  â”‚  â”‚  AI DM svc    â”‚  â”‚  WS Realtime  â”‚
â”‚ (Supabase) â”‚  â”‚  (Groq API)   â”‚  â”‚  (Supabase)   â”‚
â”‚             â”‚  â”‚  read-only    â”‚  â”‚               â”‚
â”‚  Source of  â”‚  â”‚  context only â”‚  â”‚  10-player    â”‚
â”‚  truth      â”‚  â”‚  narrates     â”‚  â”‚  rooms        â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Order of operations for every game action:**
1. Client submits action (text or structured)
2. Server validates action against DB state
3. Server calculates outcome (dice, combat math, quest check)
4. Server writes result to DB
5. Server broadcasts `GAME_EVENT` to all players via WebSocket
6. Server enqueues async narration job â†’ Groq API
7. AI narration arrives and is broadcast as display-only text

---

## Folder Structure

```
dnd-game/
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ web/                          # React + Vite frontend (Single-file client shell in early phases)
â”‚   â”‚   â””â”€â”€ src/
â”‚   â”‚       â”œâ”€â”€ assets/               # Static assets
â”‚   â”‚       â”œâ”€â”€ App.css               # Component specific styling
â”‚   â”‚       â”œâ”€â”€ App.tsx               # Main frontend codebase (All-in-one lobby/game shell)
â”‚   â”‚       â”œâ”€â”€ config.ts             # Client environment configuration
â”‚   â”‚       â”œâ”€â”€ index.css             # Main stylesheet & design system
â”‚   â”‚       â””â”€â”€ main.tsx              # Application entry point
â”‚   â”‚
â”‚   â””â”€â”€ server/                       # Node.js + Express backend
â”‚       â””â”€â”€ src/
â”‚           â”œâ”€â”€ db/
â”‚           â”‚   â”œâ”€â”€ client.ts         # pg pool â†’ Supabase connection
â”‚           â”‚   â””â”€â”€ supabase.ts       # Supabase service client
â”‚           â”œâ”€â”€ game/
â”‚           â”‚   â””â”€â”€ diceEngine.ts     # Cryptographically secure dice rolling utility
â”‚           â”œâ”€â”€ middleware/
â”‚           â”‚   â””â”€â”€ auth.ts           # Bearer-token verification via Supabase getUser()
â”‚           â”œâ”€â”€ routes/
â”‚           â”‚   â”œâ”€â”€ auth.ts           # Authentication REST endpoints
â”‚           â”‚   â”œâ”€â”€ campaigns.ts      # Campaign lobby & management REST endpoints
â”‚           â”‚   â””â”€â”€ characters.ts     # Character spawning REST endpoints
â”‚           â”œâ”€â”€ websocket/
â”‚           â”‚   â”œâ”€â”€ roomManager.ts    # WS campaign connection tracking
â”‚           â”‚   â””â”€â”€ eventHandlers.ts  # WS message parsing & routing (calls diceEngine)
â”‚           â””â”€â”€ index.ts              # Server entry point (HTTP + WebSockets)
â”‚
â”œâ”€â”€ packages/
â”‚   â””â”€â”€ shared/                       # Shared type definitions & constants
â”‚       â””â”€â”€ src/
â”‚           â”œâ”€â”€ constants/            # Game constants (races, classes, skills)
â”‚           â”œâ”€â”€ types/                # TS Types (Character, Campaign, WS events)
â”‚           â””â”€â”€ index.ts              # Entry exporter
â”‚
â””â”€â”€ brain.md                          # Source of truth project spec
```

#### Target Folder Structure (Refactoring/Modularization Plan)
When the codebase is refactored in later phases, the folders will be modularized as follows:
```
dnd-game/
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ web/
â”‚   â”‚   â””â”€â”€ src/
â”‚   â”‚       â”œâ”€â”€ components/           # Extracted UI components
â”‚   â”‚       â”‚   â”œâ”€â”€ game/             # GameView, CombatInterface
â”‚   â”‚       â”‚   â”œâ”€â”€ character/        # CharacterSheet, Inventory
â”‚   â”‚       â”‚   â”œâ”€â”€ ui/               # Chat, DicePanel, QuestLog
â”‚   â”‚       â”‚   â””â”€â”€ layout/           # Sidebar, HUD
â”‚   â”‚       â”œâ”€â”€ hooks/                # useWebSocket, useCharacter, useCombat
â”‚   â”‚       â”œâ”€â”€ stores/               # Zustand: gameStore, uiStore
â”‚   â”‚       â”œâ”€â”€ pages/                # Lobby, Campaign, CharCreate, Auth
â”‚   â”‚       â”œâ”€â”€ services/             # api.ts, ws.ts
â”‚   â”‚       â””â”€â”€ types/                # Shared TS types
â”‚   â”‚
â”‚   â””â”€â”€ server/
â”‚       â””â”€â”€ src/
â”‚           â”œâ”€â”€ routes/
â”‚           â”‚   â”œâ”€â”€ auth.ts
â”‚           â”‚   â”œâ”€â”€ campaigns.ts
â”‚           â”‚   â”œâ”€â”€ characters.ts
â”‚           â”‚   â”œâ”€â”€ quests.ts
â”‚           â”‚   â””â”€â”€ world.ts
â”‚           â”œâ”€â”€ websocket/
â”‚           â”‚   â”œâ”€â”€ roomManager.ts
â”‚           â”‚   â”œâ”€â”€ eventHandlers.ts
â”‚           â”‚   â””â”€â”€ events.ts
â”‚           â”œâ”€â”€ game/
â”‚           â”‚   â”œâ”€â”€ actionProcessor.ts
â”‚           â”‚   â”œâ”€â”€ combatEngine.ts
â”‚           â”‚   â”œâ”€â”€ diceEngine.ts     # crypto.randomInt refactored logic
â”‚           â”‚   â”œâ”€â”€ questManager.ts
â”‚           â”‚   â””â”€â”€ worldEngine.ts
â”‚           â”œâ”€â”€ ai/
â”‚           â”‚   â”œâ”€â”€ dmService.ts
â”‚           â”‚   â”œâ”€â”€ contextBuilder.ts
â”‚           â”‚   â””â”€â”€ promptTemplates.ts
â”‚           â”œâ”€â”€ db/
â”‚           â”‚   â”œâ”€â”€ client.ts
â”‚           â”‚   â”œâ”€â”€ migrations/
â”‚           â”‚   â””â”€â”€ queries/
â”‚           â””â”€â”€ middleware/
â”‚               â”œâ”€â”€ auth.ts
â”‚               â””â”€â”€ validate.ts
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

### `character_classes` â€” Primary and Hidden Classes
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
character_id    uuid REFERENCES characters(id) UNIQUE FOR PRIMARY
class_type      text NOT NULL  -- 'primary' or 'hidden'
class_name      text NOT NULL
class_level     int DEFAULT 1
unlocked_at     timestamptz    -- null for primary (created at character creation), set at unlock for hidden
unlock_story    text           -- AI-generated unlock scene narration, stored for posterity
variant         text           -- which variant of this hidden class (e.g. 'merciful_shadow_blade')
created_at      timestamptz DEFAULT now()
```

### `character_behaviour_log` â€” Behaviour Tracking
```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
character_id      uuid REFERENCES characters(id)
campaign_id       uuid REFERENCES campaigns(id)
action_type       text NOT NULL  -- 'combat_kill', 'npc_spared', 'lie_told', 'secret_found', 'ally_abandoned', etc.
tags              text[] NOT NULL -- ['shadow', 'mercy', 'deception', 'curiosity']
weight            int DEFAULT 1   -- significance 1-5
context           jsonb          -- what happened, when, where
created_at        timestamptz DEFAULT now()
```

### `character_behaviour_profile` â€” Accumulated Behaviour Scores
```sql
character_id      uuid PRIMARY KEY REFERENCES characters(id)
tag_scores        jsonb NOT NULL  -- { shadow: 47, mercy: 12, chaos: 31, ... }
updated_at        timestamptz DEFAULT now()
```

### `character_class_unlocks` â€” Hidden Class Unlock Events
```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
character_id      uuid REFERENCES characters(id)
hidden_class_id   text NOT NULL  -- references HIDDEN_CLASSES config
unlock_trigger    text          -- 'npc_contact', 'dream_sequence', 'world_event'
triggered_at      timestamptz
accepted_at       timestamptz   -- null if player refused the unlock
variant_selected  text          -- which variant was chosen (if applicable)
narrative_scene   text          -- full AI-generated unlock narrative
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

### `nemeses` â€” The Nemesis System
```sql
id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id           uuid REFERENCES campaigns(id)
name                  text NOT NULL
title                 text            -- "The Twice-Burned", "The Coward"
base_enemy_type       text NOT NULL   -- goblin, bandit, orc, etc.
level                 int DEFAULT 1
target_character_id   uuid REFERENCES characters(id)  -- who they have beef with (can be null)
history               jsonb[]         -- [ { event, result, session_date } ]
is_alive              bool DEFAULT true
personality           jsonb           -- { brutal, cowardly, cunning, honorable } â€” affects AI tactics
promoted_from_npc_id  uuid            -- if null, auto-generated; if not null, was once a named enemy
created_at            timestamptz DEFAULT now()
```

### `factions` â€” Faction Pressure System
```sql
id                   uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id          uuid REFERENCES campaigns(id)
name                 text NOT NULL
description          text
power_level          int DEFAULT 50       -- 0-100; affects world pressure
disposition_to_party int DEFAULT 0        -- -100 to +100; hostile to friendly
goals                jsonb NOT NULL       -- { short_term, long_term, current_priority }
controlled_locations uuid[] DEFAULT '{}'  -- location IDs this faction controls
leader_npc_id        uuid REFERENCES npcs(id)
created_at           timestamptz DEFAULT now()
```

### `faction_events` â€” Automated World Reactions
```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id         uuid REFERENCES campaigns(id)
faction_id          uuid REFERENCES factions(id)
trigger_condition   jsonb           -- { power_threshold: 70, disposition: 'hostile' }
action_type         text            -- 'seize_location','send_assassin','offer_contract','siege'
payload             jsonb           -- action-specific data
fired_at            timestamptz
created_at          timestamptz DEFAULT now()
```

### `world_tick_log` â€” Simulation History
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
campaign_id   uuid REFERENCES campaigns(id)
tick_number   int NOT NULL
changes       jsonb[]             -- [ { system, what_changed, why } ]
created_at    timestamptz DEFAULT now()
```

---

## Living World System â€” Four Interlocking Engines

> **Core principle:** Randomness is noise. Consequence, memory, and agency create immersion. The world doesn't react randomlyâ€”it reacts *specifically to what the party did.*

### 1. The Nemesis System
Every significant enemy becomes a named antagonist with history, personality, and a grudge.

**Mechanics:**
- When a named enemy survives combat, they're promoted (stats increase, level up)
- If a player nearly killed them, they develop *a grudge against that specific player*
- If a player fled from them, they mock that player by name: *"Running again, Thorin?"*
- If killed, their lieutenant inherits the grudge and a vendetta
- The AI receives their full history when they reappear: *"I remember the Thornwood. You left me for dead."*

**What makes this work:** The server passes the nemesis's actual event log to the AI. Every line of dialogue is grounded in real history, not generation.

### 2. Faction Pressure System
Factions compete. They gain power by controlling locations and lose it when the party interferes. When power crosses thresholds, they *take action in the world.*

**Mechanics:**
- Every faction has power level (0â€“100) and disposition to party (-100 to +100)
- Party helps faction A â†’ A's power grows, rival factions lose ground
- When faction A crosses power_level 70, a faction_event fires automatically: they seize a location, send an assassin, or offer a high-value contract
- **Key:** This happens *between sessions.* Players log in to find the town they liberated is now under occupation. The world didn't wait for them.

### 3. World Heartbeat â€” The Simulation Tick
A scheduled job (runs once per session start, or daily in real time) simulates world advancement:

- Factions gain/lose power based on goals and location control
- Nemeses move between locations (hunting the party)
- Quests ignored have consequences: the merchant they never rescued becomes a grieving widow in the town square
- New rumours are generated from recent events and seeded into tavern NPCs
- Locations under faction control change state

**What makes this work:** It's not random. Every tick is deterministic logic: *If faction A controls location X and power > 60, they expand to adjacent location Y.* The *content* feels surprising because systems interact, but each rule is fair and predictable.

### 4. NPC Agenda System â€” Upgrade to Memory
Every significant NPC now has:

- **Short-term goal** (find the warehouse thief)
- **Long-term goal** (become guild master)
- **Secret** (skimming guild funds â€” only revealed under specific conditions)
- **Relationship web** ({ npc_id: { trust, fear, owes } })

**Mechanics:**
- Server tracks NPC progress on their goals
- If party never helps the warehouse NPC, he investigates himself
- He eventually levels a *false accusation* at a rival NPC
- Party returns to town, discovers someone in the stocks for a crime they didn't commit
- This world event emerges from NPC agency, not scripting

**Upgrade to `npcs` table:**
```sql
-- Add these columns to public.npcs:
short_term_goal   text
long_term_goal    text
secret            text              -- conditions: only_if_trusted_rating_above_80, etc.
agenda_state      jsonb             -- { current_goal_progress, attempts, failures }
relationships     jsonb             -- { npc_id: { trust: 0-100, fear: 0-100, owes: text } }
```

---

## How These Systems Interact â€” A Concrete Scenario

**Session 1:** Party defeats bandit leader, lets lieutenant escape.  
â†’ World tick runs. Lieutenant (auto-promoted to Nemesis) reorganises faction. Bandit power ticks up. They seize a road.

**Session 2:** Party arrives at town. Merchant NPC (who protects trade routes) is distressedâ€”his shipments are raided. He offers a contract.  
â†’ This quest wasn't scripted. Server generated it because faction control changed and the NPC's agenda reacted.  
â†’ Mid-session: Nemesis ambushes party. He addresses the player who fled by name. AI generates dialogue from his history: *"You remember me, coward?"* He's stronger. He has a scar.

**Session 3:** Party kills Nemesis. His lieutenant witnesses it and flees.  
â†’ World tick runs. Bandit faction power collapses (too low). A rival faction moves into the power vacuum.  
â†’ Same road, different faction. Neutral disposition instead of hostile. New political situation. New story.

**Nobody wrote any of that.** It emerged from four systems with memory, goals, and consequences.

---

## The Emergent Class System
> **Core idea: A hidden class is a pattern of behaviour that the server recognises over time. The player never tries to unlock it. They just play â€” and the world responds to who they're becoming.**

### Philosophy
Standard D&D classes are chosen at character creation. This system inverts that: your *actions* accumulate into a **behavioural fingerprint**. When that fingerprint matches a hidden archetype, something shifts. An NPC finds you. A dream triggers. A door opens.

You didn't choose to become it. You *became* it.

Every meaningful action gets tagged with invisible **behaviour weights**. The player never sees these numbers. The server silently accumulates them. When thresholds are crossed, the world delivers an unlock event â€” always grounded in the character's actual history.

### Behaviour Tagging
Every significant action is tagged with behaviour vectors:

- **Combat kill** â†’ tag: `shadow`, weight: 3
- **NPC spared** â†’ tag: `mercy`, weight: 2
- **Lie told** â†’ tag: `deception`, weight: 2
- **Secret discovered** â†’ tag: `curiosity`, weight: 3
- **Ally abandoned** â†’ tag: `chaos`, weight: 4
- **Forbidden knowledge sought** â†’ tag: `forbidden`, weight: 3
- **Deal made with entity** â†’ tag: `forbidden`, weight: 5

The tags accumulate in `character_behaviour_profile.tag_scores`. The player has no access to these numbers. Ever.

### Hidden Class Definition â€” The Config
You define 10â€“15 patterns before launch. Each is just a **threshold configuration** â€” no code changes needed:

```typescript
// src/config/hiddenClasses.ts
export const HIDDEN_CLASSES = [
  {
    id: 'shadow_blade',
    name: 'Shadow Blade',
    unlock_conditions: {
      tag_thresholds: { shadow: 40, deception: 30 },  // behavioural minimums
      stat_requirements: { dex: 14 },
      action_requirements: ['killed_sleeping_enemy', 'stolen_from_ally'],
      level_minimum: 4
    },
    trigger: 'npc_contact',     // how unlock is delivered
    variants: [
      {
        id: 'merciful_shadow',
        condition: { mercy: 20 }  // secondary condition
      },
      {
        id: 'cruel_shadow',
        condition: { cruelty: 20 }
      }
    ]
  },
  {
    id: 'oathbreaker',
    name: 'Oath Breaker',
    unlock_conditions: {
      tag_thresholds: { betrayal: 50, chaos: 20 },
      action_requirements: ['broke_sworn_quest', 'attacked_ally_in_combat'],
      level_minimum: 3
    },
    trigger: 'dream_sequence'
  },
  {
    id: 'void_touched',
    name: 'Void-Touched',
    unlock_conditions: {
      tag_thresholds: { forbidden: 60, curiosity: 40 },
      action_requirements: ['read_forbidden_tome', 'made_deal_with_entity'],
      level_minimum: 5
    },
    trigger: 'world_event'
  }
  // Add more anytime without touching game logic
]
```

You don't need to know what `shadow_blade` *feels like* to define it. You know who unlocks it. The AI writes the unlock scene. The story is emergent.

### The Unlock Experience â€” Three Delivery Types

**`npc_contact`** â€” A mysterious NPC seeks the character out  
The AI narrates using the character's actual behaviour history. The NPC has been watching. *"I've heard about what you did in Thornwall. The way you moved through shadows. I have a proposition."*  
The player can refuse. That refusal is logged.

**`dream_sequence`** â€” On the next long rest  
The character has a vision generated by the AI using their behaviour tags as emotional core. Unsettling. Personal. At the end, a choice. The choice determines the variant.

**`world_event`** â€” The world changes visibly  
A locked door they visited before is now open. A faction they didn't know existed sends a messenger. A location transforms. The world acknowledges who they've become.

### Variant Resolution
Each hidden class has 2â€“4 **variants** determined by secondary behaviour at unlock moment.

A character who qualifies for `Shadow Blade` but also has high `mercy` scores gets a different variant than one with high `cruelty`. Same unlock trigger, different mechanics, different AI-generated unlock scene.

You define the variants but *genuinely don't know which one* any given player hits â€” because it depends on their full behaviour complexity over months of play.

### What this achieves
The player's specific actions â€” the merchant they betrayed in session 2, the forbidden book they read when alone, the ally they abandoned â€” those exact moments are *why* this happened *to this character*.

The AI can reference all of it in the unlock scene because it's in the event log. That's what makes it feel alive.

---

## WebSocket Events
```
ACTION_SUBMIT      { type, payload }   -- player action text or structured
DICE_REQUEST       { dice_type, context, modifier }
CHAT_MESSAGE       { text }
JOIN_CAMPAIGN      { invite_code }
RECONNECT          { campaign_id, character_id }
COMBAT_ACTION      { action_type, target_id }
```

### Server â†’ Client (broadcast)
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

CONTEXT (authoritative â€” do not contradict):
[structured JSON snapshot]

YOUR ROLE:
- Narrate what just happened in vivid prose
- Voice NPCs with personality consistent with their relationship values
- Build atmosphere and tension
- Advance the story

FORBIDDEN â€” never do these under any circumstances:
- Assign or mention specific XP values
- Modify or state HP values
- Declare quest objectives complete
- Invent items in a character's inventory
- State a die roll result before one is provided to you
- Kill or revive characters
- Contradict any fact in the context block above

Respond with 2â€“4 paragraphs of narration only. No meta-commentary.
```

---

## Hallucination Prevention â€” 6 Layers

1. **Structured context only.** AI receives a typed snapshot, not free-form conversation history. Every fact comes from a DB query.

2. **AI output is display-only.** There is no code path from `dmService.ts` response â†’ DB write. Narration is stored as `event_log.ai_narration` (text column, never parsed).

3. **Server calculates first, AI narrates second.** The game engine commits results to DB and broadcasts to clients before the async narration job even starts.

4. **Explicit forbidden-actions block in every system prompt.** Non-negotiable â€” regenerated fresh on every call, never cached.

5. **Minimal context window.** Only the location, present NPCs, last 10 events, and active quests are sent. The AI cannot speculate about things it hasn't been told.

6. **Output filter before display.** A post-processing regex pass checks narration for patterns like "you gain X XP", "you take X damage", "the quest is complete" and strips or flags them before broadcasting. Defense in depth, not primary enforcement.

---

## Development Roadmap

> Tick every box before moving to the next phase. Each phase ends with something genuinely playable.

---

### Phase 1 â€” Foundation
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
- [x] Add auth middleware (verify Supabase auth bearer token via `getUser()`)
- [x] Add `POST /api/auth/register` route
- [x] Add `POST /api/auth/login` route
- [x] Add `POST /api/auth/logout` route
- [x] Add WebSocket server (`ws` library) on same HTTP server
- [ ] Confirm server deploys to Render free tier

#### WebSocket room manager
- [x] Create `roomManager.ts` â€” Map of campaignId â†’ Set of WebSocket connections
- [x] Handle `JOIN_CAMPAIGN` event â€” add socket to room
- [x] Handle `disconnect` â€” remove socket, broadcast `PLAYER_LEFT`
- [x] Handle `RECONNECT` event â€” reattach socket to existing room
- [x] Enforce max 10 players per room
- [x] Broadcast helper: `broadcastToRoom(campaignId, event, payload)`

#### Campaign system
- [x] Add `POST /api/campaigns` â€” create campaign, generate 6-char invite code
- [x] Add `GET /api/campaigns/:id` â€” fetch campaign + members
- [x] Add `POST /api/campaigns/join` â€” join via invite code, insert into campaign_members
- [x] Add `GET /api/campaigns/:id/members` â€” list party

#### Character creation
- [x] Add `POST /api/characters` â€” create character, validate race/class/attributes
- [x] Add `GET /api/characters/:id` â€” fetch full character sheet
- [x] Auto-calculate HP max from class + CON modifier on creation
- [x] Auto-calculate skill modifiers from attributes on creation

#### Frontend â€” auth + lobby
- [x] Init React + Vite + TypeScript + Tailwind
- [x] Set up Zustand stores: `authStore`, `gameStore`, `uiStore`
- [x] Build Login page (email/password form â†’ Supabase Auth)
- [x] Build Register page
- [x] Build Lobby page: create campaign or join via invite code
- [x] Build CharacterCreate page: pick race, class, name, roll/assign attributes
- [x] Protect routes â€” redirect to login if no session
- [x] Connect WebSocket on campaign join, store socket in `gameStore`

#### Frontend â€” game shell
- [x] Build main game layout: sidebar (party list) + center (narration/chat) + right panel (char sheet)
- [x] Build live chat component â€” send `CHAT_MESSAGE`, render `GAME_EVENT` of type chat
- [x] Build party list component â€” show name, class, level, online/offline status
- [x] Show `PLAYER_JOINED` / `PLAYER_LEFT` toast notifications
- [x] Persist auth session across page refresh

**Phase 1 done when:** Two people can open the app in different browsers, join the same campaign via invite code, see each other in the party list, and send chat messages in real time.

---

### Phase 2 â€” Game systems
**Goal: players can explore, roll dice, manage inventory, and track quests**

#### Dice engine
- [x] Build `diceEngine.ts` â€” `rollDice(type, modifier)` using `crypto.randomInt`
- [x] Add `DICE_REQUEST` WebSocket handler on server
- [x] Server rolls dice, writes result to `dice_rolls` table
- [x] Server broadcasts `DICE_RESULT` to all room members
- [x] Build DicePanel UI â€” buttons for d4/d6/d8/d10/d12/d20/d100
- [x] Show roll history in chat feed with roller name and context
- [x] Add modifier input to dice panel (+/- value before roll)

#### Action processor
- [x] Build `actionProcessor.ts` â€” receives raw action text, classifies it
- [x] Add `ACTION_SUBMIT` WebSocket handler
- [x] Validate action: is it the player's character? Are they in the campaign?
- [x] Dispatch to correct subsystem (exploration, skill check, interact) â€” **PARTIAL**: skill checks now roll d20 + modifier and log event; NPC interactions still treated as generic exploration
- [x] Write result to `event_log`
- [x] Broadcast `GAME_EVENT` to room

#### World system
- [x] Seed starting world: 3 locations (town, dungeon entrance, wilderness)
- [x] Add `GET /api/campaigns/:id/world` â€” return locations, connections, state
- [ ] Build location component â€” show name, type, description, and lore â€” **NOT IMPLEMENTED**: server returns world data but client has no UI to display locations or allow movement
- [ ] Show present NPCs in the location component â€” **NOT IMPLEMENTED**: blocked on location UI
- [x] Allow movement between connected locations (server validates, updates character position in world_state)
- [x] World state changes persist â€” if a location is "discovered", it stays discovered
- [x] Add `WORLD_UPDATE` WebSocket broadcast on state change

#### Inventory system
- [x] Seed item catalog (20 starter items: weapons, armor, potions, misc)
- [x] Add `POST /api/characters/:id/inventory` â€” server adds item (never client-direct)
- [x] Add `DELETE /api/characters/:id/inventory/:itemId` â€” drop item
- [x] Add `PATCH /api/characters/:id/inventory/:itemId/equip` â€” toggle equipped
- [x] Build Inventory panel UI â€” grid of items, equip/drop buttons
- [x] Show equipped items on character sheet with stat bonuses applied
- [ ] Gold transactions â€” server-only, logged in event_log

#### Quest system
- [x] Add `POST /api/campaigns/:id/quests` â€” create quest (server/DM only)
- [x] Add `GET /api/campaigns/:id/quests` â€” list active + completed quests
- [x] Add `PATCH /api/campaigns/:id/quests/:id/objective` â€” mark objective complete (server only)
- [x] Build QuestLog UI â€” active quests, objectives with checkmarks, completed section
- [x] Add `QUEST_UPDATE` WebSocket broadcast on any quest change
- [x] Seed 3 starter quests for new campaigns

#### Character sheet
- [x] Build basic CharacterSheet panel: attributes, skills, HP, gold â€” **PARTIAL**: all core attributes now shown including skills list
- [x] Show derived stats: AC (from equipped armor), attack bonus, spell save DC
- [ ] Add level-up logic: XP threshold check, HP increase, stat point allocation
- [x] Skill check roll button on each skill (auto-rolls d20 + skill modifier)
- [x] Character sheet updates live via `GAME_EVENT` broadcast

#### Event log UI
- [x] Build scrolling event log â€” shows all game events in chronological order
- [x] Colour-code by event type: combat (red), quest (gold), chat (white), system (grey)
- [x] Load last 50 events on join (catch-up for reconnects)

**Phase 2 done when:** Players can move between locations (once location UI is built), roll dice with modifiers, pick up items, equip gear, see quests in a log, and all of it persists across page reloads. **NOTE:** Server-side infrastructure for world movement is complete; frontend location/movement UI still needed before Phase 2 is truly playable.

---

### Phase 3 â€” AI + Combat + Living World
**Goal: full sessions with AI narration, turn-based combat, living NPCs, and a world that remembers**

#### Combat engine
- [x] Build `combatEngine.ts` with full turn-based logic
- [x] Initiative roll: d20 + DEX modifier for each participant, sorted descending
- [x] Attack roll: d20 + attack bonus vs target AC — hit or miss
- [x] Damage roll: weapon damage dice + STR/DEX modifier on hit
- [x] Apply damage to target HP in DB, check for death (HP ≤ 0)
- [x] Death saves: d20 on downed character's turn, 3 successes = stable, 3 fails = dead
- [ ] Conditions: poisoned, stunned, paralysed — store in participant jsonb, apply mechanical effects
- [x] Enemy AI turn logic (code-based): pick nearest player, roll attack, apply damage
- [x] Handle end of combat: XP distribution, loot generation (server calculates)
- [x] Add `COMBAT_ACTION` WebSocket handler — validate it's actor's turn, execute, broadcast `COMBAT_UPDATE`
- [x] Build CombatInterface UI: turn order tracker, HP bars, action buttons (attack, dodge, end turn)
- [ ] Show dice rolls animated in UI during combat

#### Nemesis System
- [x] Build `nemesisEngine.ts` — handles enemy promotion, memory, and personality
- [x] After combat: check if any enemies survived; promote to nemesis with level up, scars, and grudge selection
- [x] Track nemesis history: database table `nemesis_history` with full encounter logs
- [x] Add target_character_id: targets player with highest impact or who downed them
- [x] Generate nemesis personality (brutal, cowardly, cunning, honorable, vengeful, warlord, paranoid) — affects tactics and target selection
- [x] Nemesis AI: custom targeting rules and minion command logic per personality/tier
- [x] On nemesis death: successor system assigns grudge, bounty, and successor links
- [x] Build nemesis gallery UI — premium frontend gallery with card grids, timelines, and DM controls

#### Faction Pressure System
- [ ] Create base factions for starter world (Order of the Cloaked Flame, Blackwater Syndicate, Merchant's Guild, Druidic Circle)
- [ ] Build `factionEngine.ts` — tracks power, disposition, goals
- [ ] Implement power calculation: faction gains power when they control locations/defeat enemies, lose it when locations are liberated
- [ ] Implement disposition calculation: changes based on party actions for/against that faction
- [ ] Build faction_events trigger system: when power crosses thresholds (50, 70, 90), fire corresponding actions
- [ ] Action types: 'seize_location', 'send_assassin', 'offer_contract', 'siege', 'install_ruler'
- [ ] Persist faction_events to DB; show in world_tick_log

#### World Heartbeat — Simulation Tick
- [/] Build `worldHeartbeat.ts` — integrated nemesis movement and rest ambushes into action processor
- [x] Tick nemesis movement: move active nemeses between locations based on grudge and faction coordination
- [x] Grudge-biased rest ambush: high grudge triggers ambush on party rest
- [x] Warlord location control: warlord-tier nemeses claim locations under `nemesis_controlled` flags
- [ ] Tick faction power: update based on current controlled locations and goals
- [ ] Tick faction events: fire any events with trigger_condition met
- [ ] Tick NPC agendas: update short-term goal progress; if stuck, trigger NPC-initiated world event
- [ ] Generate new rumours from recent events; seed into tavern NPCs (via npc.memory_log)
- [ ] Update location state: if under faction siege, mark as 'under_occupation', update description
- [ ] Log all changes to world_tick_log with reasoning
- [ ] Broadcast `WORLD_UPDATE` to all connected players showing faction-driven changes

#### NPC Agenda System
- [ ] Upgrade `npcs` table: add short_term_goal, long_term_goal, secret, agenda_state, relationships
- [ ] Build `npcAgendaEngine.ts` â€” tracks NPC goals and progress
- [ ] Short-term goals: investigation, acquisition, socialising (each has a success condition)
- [ ] Long-term goals: self-improvement, power, wealth (check progress on each world tick)
- [ ] Secrets: revealed only if relationship trust > 80 or under duress
- [ ] Relationship tracking: if NPC helps party, trust increases; if party betrays them, trust decreases
- [ ] NPC-initiated events: if NPC reaches end of short-term goal without player help, they take solo action (accuse someone, strike a deal, abandon location)
- [ ] Build NPC profile UI â€” show goals, secrets (if known), and relationship status with party

#### Groq narration upgrade
- [ ] Expand context builder to include: nemesis history, NPC agenda status, faction disposition, recent world_tick changes
- [ ] Build `nemesisContextBuilder.ts` â€” extracts nemesis personality and history for AI
- [ ] Build `factionContextBuilder.ts` â€” extracts faction goals and recent actions for world narration
- [ ] Expand system prompt: *"Narrate using the nemesis's personality. Reference their specific history. Show the world reacting to faction pressure."*
- [ ] Stream narration that incorporates: specific character names (nemesis), specific past events (history), faction movements (world pressure)

#### Procedural quest generation (upgraded)
- [ ] Build quest generator: pick template (fetch, kill, escort, find, political, faction)
- [ ] Political quests: generated from NPC agendas and faction conflicts
- [ ] Faction quests: generated from faction_events (seize location â†’ defend location quest)
- [ ] Server can auto-generate a quest when party enters a location with no active quests
- [ ] Generated quests go through same DB + broadcast flow as hand-authored quests
- [ ] Quests now reference nemeses and factions in their objectives (kill nemesis, secure location for faction)

#### Emergent Class System
- [ ] Create `character_behaviour_log` and `character_behaviour_profile` tables
- [ ] Create `character_classes` table (replace single class column on characters)
- [ ] Build `hiddenClassEngine.ts` â€” runs after every action, checks unlock thresholds
- [ ] Implement behaviour tagging: every action type (kill, spare, lie, betray, etc.) increments relevant tags
- [ ] Define `HIDDEN_CLASSES` config file with 10â€“15 pattern definitions (editable, no code changes needed)
- [ ] Build behaviour threshold checker: when profile crosses unlock_conditions, queue unlock event
- [ ] Implement three unlock delivery types:
  - `npc_contact`: AI-generated NPC encounter referencing character's behaviour history
  - `dream_sequence`: AI-generated dream vision using behaviour tags as emotional core
  - `world_event`: Visible world change (door opens, faction messenger arrives, etc.)
- [ ] Build variant resolver: determine which variant based on secondary behaviour scores
- [ ] Store unlock_story narration in `character_class_unlocks` for posterity
- [ ] Allow player to refuse unlock (refusal is logged)
- [ ] Build hidden class UI: show class name and flavour only after unlock
- [ ] Extend AI context builder: include character's behaviour tags and unlock history
- [ ] Ensure AI references actual behaviour history in unlock narration

#### Phase 2 catch-up (still needed before Phase 3 is playable)
- [ ] **Build location/world navigation UI** â€” players can see locations, see connections, click to move (blocks all Phase 2 completion)
- [x] Build inventory system REST endpoints + UI (needed before equipment affects combat)
- [x] Build quest log UI (needed for faction-generated quests)
- [x] Seed item catalog and starter quests

**Phase 3 done when:** Party can fight a named Nemesis who remembers them by name, the world pressure changes based on faction power, a new quest appears because an NPC's agenda progressed, a character unlocks a hidden class through their behaviour pattern, and after Session 1 the party logs in to find the world has changed while they were gone.

---

### Phase 4 â€” Polish
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
- [ ] "Share session recap" â€” generates plain text summary of the session

#### Balancing
- [ ] XP per enemy type balanced to level 1â†’5 in ~10 sessions
- [ ] Starting gold and item prices tuned for early game
- [ ] Enemy HP and damage values playtested at level 1, 3, 5
- [ ] Encounter rate: random combat trigger on wilderness movement (~30% chance)

#### Production deploy
- [ ] Configure Render deploy (set all env vars, health check endpoint)
- [ ] Configure Vercel deploy (set VITE_ env vars, production build)
- [ ] Set up Supabase production project (separate from dev)
- [ ] Smoke test: full session from register â†’ campaign â†’ combat â†’ AI narration on production URLs
- [ ] Write one-page setup guide for invite link sharing

**Phase 4 done when:** You can send a friend an invite link, they sign up, join your campaign, play a session with combat and AI narration, and it feels like a real game â€” not a prototype.

---

## API Routes

```
// === Implemented REST Endpoints ===
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/me

POST   /api/campaigns                    # create campaign
GET    /api/campaigns                    # list campaigns user belongs to
POST   /api/campaigns/join               # join via invite code
GET    /api/campaigns/:id                # get campaign details
GET    /api/campaigns/:id/members        # list campaign members and linked characters
GET    /api/campaigns/:id/events         # recent event log catch-up
GET    /api/campaigns/:id/world          # locations, connections, and campaign world state
GET    /api/campaigns/:id/quests         # list active and completed quests
GET    /api/campaigns/:id/quests/:questId # retrieve one quest
POST   /api/campaigns/:id/quests         # DM creates a quest
PATCH  /api/campaigns/:id/quests/:questId/objective # DM toggles a quest objective

POST   /api/characters                   # create character
GET    /api/characters/:id               # retrieve character details
GET    /api/characters/campaign/:campaignId # list campaign characters
GET    /api/characters/item-catalog      # list starter item catalog
GET    /api/characters/:id/inventory     # list character inventory
POST   /api/characters/:id/inventory     # grant item to character
DELETE /api/characters/:id/inventory/:itemId # drop inventory item
PATCH  /api/characters/:id/inventory/:itemId/equip # equip or unequip item

// === Planned REST Endpoints (Phase 2 & 3) ===
PATCH  /api/characters/:id               # server-only mutations

```

All mutation endpoints require auth middleware. Character stat updates are server-internal only â€” no public PATCH route for HP, gold, or inventory.

Health endpoints:
`GET /health` for app status and `GET /health/db` for database connectivity.

---

## Environment Variables

### Server (.env)
```
DATABASE_URL=postgresql://...          # Supabase connection string
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...                  # public auth client key
SUPABASE_SERVICE_KEY=...               # server-side only
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

**Why WebSockets over Supabase Realtime for game events?** Supabase Realtime is built on Postgres changes â€” excellent for data sync but adds latency and complexity for bidirectional game events. A ws library on the Express server gives full control over room logic, reconnect handling, and event ordering. Supabase Realtime can optionally be used as a fallback.

**Why Turborepo?** The `@dnd/shared` package lets the frontend import the exact same TypeScript types as the server. Prevents type drift between client and server models â€” a common source of bugs in multiplayer games.

**Why jsonb for attributes/skills/stats?** D&D has many optional systems (feats, spell slots, class features). Jsonb avoids constant migration churn as game content expands. Core game logic uses known keys; the rest is flexible.

**Why store AI narration in event_log?** Session replay, party members who reconnected mid-session, and the world encyclopedia all benefit from a persistent narration history. It also makes debugging AI output easy.

---

*brain.md — last updated: 2026-06-07 quest and character sheet update*
