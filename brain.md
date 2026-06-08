# brain.md - DND Game Source of Truth

> Private multiplayer D&D game for a friend group. The server is authoritative. AI narrates, but it never decides game state.

## Current Status

Last updated: 2026-06-08

- GitHub repo: `https://github.com/ironhammer2204-pixel/DND-Game`
- Supabase project: `fvgpsqksclhyvaeveaus`
- `brain.md` must be updated after every meaningful fix, feature, schema change, setup change, or architecture decision.
- **Database Migrations**: All 13 local database migrations (including schema fixes, nemesis system, behavior/world engines, faction pressure, bug fixes, NPC agendas, auth triggers, encyclopedia, balancing engine, RLS/index hardening, rumours table cleanup, polymorphic integrity validation, and era_id indexing) have been fully applied to the remote Supabase instance.
- **Async Queue & Workers**: AI narration requests and player intent classifications are processed asynchronously via a `pg-boss` queue backed by PostgreSQL. The workers support array-based jobs and respect concurrency limits (localConcurrency of 1).
- **Fallback & Output Repair**: Narration outputs from Groq are filtered to preserve the "AI is never source of truth" invariant. Filtered narrations are validated and cleaned of formatting/grammatical issues, reverting to high-quality fallback narrations if empty or broken.
- **Automated Validation**: A local migration linter script (`scripts/lint-migrations.js`) verifies database migrations for RLS compliance, foreign-key indexing, case-insensitive naming conflicts, and `updated_at` triggers.
- **Enhanced Health Monitoring**: The `/health` endpoint checks DB latency, Groq API availability, pg-boss queue depth, active WebSocket connection counts, and the last narration success timestamp.
- **Test Coverage**: High-coverage Vitest tests verify narration filtration, fallback execution, and queue job delegation (95 passing tests total).

## Product Snapshot

The current user-facing surfaces are:

- Auth page
- OAuth callback handling
- Lobby with campaign cards, create campaign, and invite-code join
- Main game shell for players
- DM-facing control surfaces for world state, balance, factions, encyclopedia, and nemeses
- Reconnect banner and websocket recovery flow
- Chat, narration, event log, dice panel, inventory, quest log, world travel, and character inspector

## Stack

| Layer | Technology | Provider | Cost |
|---|---|---|---|
| Frontend | React + TypeScript + Vite | Vercel | $0 |
| Backend | Node.js + Express | Render | $0 |
| Database | PostgreSQL | Supabase | $0 |
| Auth | Supabase Auth + JWT | Supabase | $0 |
| Realtime | WebSockets + Supabase support where needed | Render / Supabase | $0 |
| AI Dungeon Master | Groq-powered narration | Groq | $0 |
| Monorepo | Turborepo | - | $0 |

## Core Principle

The AI is not the source of truth.

| AI can | AI cannot |
|---|---|
| Narrate outcomes | Change player stats directly |
| Describe scenes | Change inventories or gold directly |
| Roleplay NPCs | Decide combat results |
| Suggest story beats | Write authoritative state without the server |

## Architecture

```text
CLIENTS (React + TypeScript)
  -> HTTP + WebSocket
EXPRESS API SERVER
  -> Auth middleware, routes, room management, game logic
GAME SYSTEMS
  -> Dice engine, combat engine, world engine, faction engine, nemesis engine, encyclopedia engine, balancing engine
DATA + AI
  -> PostgreSQL source of truth
  -> Supabase Auth for login/session verification
  -> Groq narration pipeline for DM text only
```

## Folder Structure

```text
DNDGame/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── components/
│   │       │   ├── BalanceDashboard.tsx
│   │       │   ├── DicePanel.tsx
│   │       │   ├── EncyclopediaPanel.tsx
│   │       │   ├── FactionControlRoom.tsx
│   │       │   ├── NemesisGallery.tsx
│   │       │   └── WsReconnectBanner.tsx
│   │       ├── pages/
│   │       │   ├── AuthCallback.tsx
│   │       │   ├── AuthPage.tsx
│   │       │   ├── GamePage.tsx
│   │       │   └── LobbyPage.tsx
│   │       ├── stores/
│   │       │   ├── authStore.ts
│   │       │   └── gameStore.ts
│   │       ├── App.tsx
│   │       ├── App.css
│   │       ├── config.ts
│   │       ├── index.css
│   │       └── main.tsx
│   └── server/
│       └── src/
│           ├── ai/
│           ├── db/
│           ├── game/
│           ├── middleware/
│           ├── routes/
│           ├── websocket/
│           └── index.ts
├── packages/
│   └── shared/
│       └── src/
│           ├── constants/
│           ├── types/
│           └── index.ts
└── brain.md
```

## Current App Shape

`apps/web/src/App.tsx` routes the whole experience:

- no token or user -> `AuthPage`
- auth callback path -> `AuthCallback`
- token and user but no active campaign -> `LobbyPage`
- active campaign -> `GamePage`

`apps/web/src/pages/GamePage.tsx` is the main shell and pulls in:

- websocket reconnect banner
- dice panel
- nemesis gallery
- faction control room
- encyclopedia panel
- balance dashboard
- inventory, quests, travel, combat, and character state

## Server Shape

`apps/server/src/index.ts` currently wires:

- Express middleware
- auth routes
- campaign routes
- character routes
- faction routes
- encyclopedia routes
- balance routes
- websocket server
- narration broadcasts
- graceful shutdown for HTTP, websocket, and pg pool
- periodic balancing timer

## API Routes

Implemented or present in code:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/me`
- `GET /health`
- `GET /health/db`
- campaign, character, faction, encyclopedia, balance, and nemesis routes under `/api/campaigns` and `/api/characters`

## Development Roadmap

### Phase 1 - Foundation
Auth, lobby, campaign join/create, room flow, and reconnect are in place.

### Phase 2 - Core Game Systems
Dice, quests, inventory, world travel, character management, encyclopedia, and balance features are in place.

### Phase 3 - Living World
Combat loop, nemesis system, faction pressure, AI narration, and world-state propagation are in place.

### Phase 4 - Polish
Remaining work is mostly UI refinement, mobile tuning, hardening, and deploy quality-of-life fixes.

## Environment Variables

See [ENV_SETUP.md](file:///Users/Ayan/Documents/DNDGame/files/ENV_SETUP.md) for full setup instructions.

```text
Server:
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
GROQ_API_KEY=...
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://ironhammer.vercel.app

Client (Local Dev):
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001

Client (Vercel Prod):
VITE_API_URL=https://your-tunnel.trycloudflare.com
VITE_WS_URL=wss://your-tunnel.trycloudflare.com
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

## Key Design Decisions

- The server verifies auth and owns game state.
- The AI is narration only and never writes authoritative state directly.
- WebSocket rooms should remain small and stable for a private group.
- Campaign, combat, quest, and world changes are persisted through PostgreSQL.
- `brain.md` is the living summary for future sessions and must stay aligned with the real codebase.
