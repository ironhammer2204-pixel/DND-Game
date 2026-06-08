# brain.md - DND Game Source of Truth

> Private multiplayer D&D game for a friend group. The server is authoritative. AI narrates, but it never decides game state.

## Current Status

Last updated: 2026-06-08

- GitHub repo: `https://github.com/ironhammer2204-pixel/DND-Game`
- Supabase project: `fvgpsqksclhyvaeveaus`
- `brain.md` must be updated after every meaningful fix, feature, schema change, setup change, or architecture decision.
- **[x] Dark Fantasy RPG UI & Routed Architecture**: Fully completed the migration from a monolithic page structure (`GamePage.tsx`) to a clean, component-routed layout. Integrated Tailwind CSS v4, Radix UI components (14 themed UI primitives), Lucide icons, Recharts, and Sonner. Everything is completely isolated under a `.game-shell` selector class so that Auth and Lobby styles remain untouched.
- **[x] Database Migrations**: All 13 local database migrations (including schema fixes, nemesis system, behavior/world engines, faction pressure, bug fixes, NPC agendas, auth triggers, encyclopedia, balancing engine, RLS/index hardening, rumours table cleanup, polymorphic integrity validation, and era_id indexing) have been fully applied to the remote Supabase instance.
- **[x] Async Queue & Workers**: AI narration requests and player intent classifications are processed asynchronously via a `pg-boss` queue backed by PostgreSQL. The workers support array-based jobs and respect concurrency limits (localConcurrency of 1).
- **[x] Fallback & Output Repair**: Narration outputs from Groq are filtered to preserve the "AI is never source of truth" invariant. Filtered narrations are validated and cleaned of formatting/grammatical issues, reverting to high-quality fallback narrations if empty or broken.
- **[x] Automated Validation**: A local migration linter script (`scripts/lint-migrations.js`) verifies database migrations for RLS compliance, foreign-key indexing, case-insensitive naming conflicts, and `updated_at` triggers.
- **[x] Enhanced Health Monitoring**: The `/health` endpoint checks DB latency, Groq API availability, pg-boss queue depth, active WebSocket connection counts, and the last narration success timestamp.
- **[x] Test Coverage**: High-coverage Vitest tests verify narration filtration, fallback execution, and queue job delegation (95 passing tests total).

## Product Snapshot

The current user-facing surfaces are:

- Auth page
- OAuth callback handling
- Lobby with campaign cards, create campaign, and invite-code join
- Main game routed navigation interface for active players (Dashboard, Combat, Character Sheet, Journal, settings Menu)
- DM-facing control surfaces (Factions control, Balance dashboard, World state, Encyclopedia editing, and Nemeses gallery)
- Reconnect banner and websocket recovery flow
- Chat, narration, event log, dice panel, inventory, quest log, world travel, and character inspector

## Stack

| Layer | Technology | Provider | Cost |
|---|---|---|---|
| Frontend | React + TypeScript + Vite + Tailwind CSS v4 + Radix UI | Vercel | $0 |
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
│   │       │   ├── game/
│   │       │   │   ├── ConditionChip.tsx
│   │       │   │   ├── DiceRoll.tsx
│   │       │   │   ├── HpBar.tsx
│   │       │   │   ├── RunicDivider.tsx
│   │       │   │   └── StaleDataBanner.tsx
│   │       │   ├── navigation/
│   │       │   │   ├── DesktopNav.tsx
│   │       │   │   ├── Guards.tsx
│   │       │   │   ├── MobileNav.tsx
│   │       │   │   └── RootLayout.tsx
│   │       │   └── ui/
│   │       │       ├── avatar.tsx
│   │       │       ├── badge.tsx
│   │       │       ├── button.tsx
│   │       │       ├── card.tsx
│   │       │       ├── dialog.tsx
│   │       │       ├── input.tsx
│   │       │       ├── label.tsx
│   │       │       ├── progress.tsx
│   │       │       ├── scroll-area.tsx
│   │       │       ├── separator.tsx
│   │       │       ├── sonner.tsx
│   │       │       ├── switch.tsx
│   │       │       ├── tabs.tsx
│   │       │       └── tooltip.tsx
│   │       ├── context/
│   │       │   └── CampaignContext.tsx
│   │       ├── lib/
│   │       │   └── utils.ts
│   │       ├── pages/
│   │       │   ├── campaign/
│   │       │   │   ├── BalancePage.tsx
│   │       │   │   ├── CharacterSheetPage.tsx
│   │       │   │   ├── CombatPage.tsx
│   │       │   │   ├── DashboardPage.tsx
│   │       │   │   ├── FactionsPage.tsx
│   │       │   │   ├── JournalPage.tsx
│   │       │   │   └── MenuPage.tsx
│   │       │   ├── AuthCallback.tsx
│   │       │   ├── AuthPage.tsx
│   │       │   └── LobbyPage.tsx
│   │       ├── router/
│   │       │   └── gameRouter.tsx
│   │       ├── stores/
│   │       │   ├── authStore.ts
│   │       │   └── gameStore.ts
│   │       ├── styles/
│   │       │   └── game-theme.css
│   │       ├── App.tsx
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
- active campaign -> `GameRouter`

`apps/web/src/router/gameRouter.tsx` sets up nested navigation with:
- Desktop sidebar navigation (`DesktopNav`) and mobile bottom tabs navigation (`MobileNav`) inside `RootLayout`
- Route guards to block players from accessing DM surfaces (`DmOnlyRoute`) or force redirects when combat is active (`CombatActiveRoute`)
- Direct routing to all game page components under the unified `CampaignProvider` context.

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
- [x] Auth, lobby, campaign join/create, room flow, and reconnect are in place.

### Phase 2 - Core Game Systems
- [x] Dice, quests, inventory, world travel, character management, encyclopedia, and balance features are in place.

### Phase 3 - Living World
- [x] Combat loop, nemesis system, faction pressure, AI narration, and world-state propagation are in place.

### Phase 4 - Routed Dark Fantasy UI
- [x] Tailwind CSS v4 and Radix UI primitives configured.
- [x] Scoped styling system with `.game-shell` wrapper for CSS isolation.
- [x] Campaign pages implemented: Dashboard, Combat, Character Sheet, Journal, settings Menu, DM Factions, and DM Balance.
- [x] Nested routing configuration with responsive `DesktopNav` and `MobileNav`.
- [x] Route access guards (`DmOnlyRoute`, `CombatActiveRoute`).
- [x] Integrated `CampaignContext` data bridge mapping Zustand state to local routes.
- [x] Zero-error build output (`tsc -b && vite build` clean).

### Phase 5 - Polish
- [ ] Loading/empty/error states audit across pages.
- [ ] Comprehensive mobile tuning & responsive testing.
- [ ] Keyboard navigation and accessibility audit.
- [ ] Dynamic bundle splitting for heavier modules.

## Environment Variables

See `ENV_SETUP.md` for full setup instructions.

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
