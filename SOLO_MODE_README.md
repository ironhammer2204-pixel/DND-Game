# Solo Mode Implementation Guide

## Problem Solved

Your original game had these single-player blockers:
1. **AI DM requires GROQ_API_KEY** → Falls silent without API key
2. **Encyclopedia depends on complex DB state** → Empty entries, no content
3. **Combat requires WebSocket + human DM** → Can't fight alone
4. **No solo initialization flow** → Game doesn't start for 1 player

## Solution Architecture

### Files Added

1. **`apps/server/src/game/soloEngine.ts`** (34KB)
   - Self-contained single-player game engine
   - Offline AI DM with 50+ narrations (no API key needed)
   - Auto-seeding encyclopedia with starter content
   - Automated enemy AI (no human DM needed)
   - State machine: exploration → combat → rest → level-up

2. **`apps/server/src/routes/solo.ts`** (11KB)
   - REST API endpoints for solo play
   - No WebSocket required (works with polling)
   - Character creation, actions, status checks

3. **`index_modifications.md`** - Integration guide

### How It Works

```
Player → POST /api/solo/start (creates campaign + character)
   ↓
Auto-seeds: locations, NPCs, quests, encyclopedia
   ↓
Player → POST /api/solo/action (move, explore, combat, rest)
   ↓
Engine processes → Returns narration + state update
   ↓
AI available? Uses Groq. Not available? Uses offline narrations
```

## Quick Start (For Players)

### 1. Create Character & Start Adventure
```bash
curl -X POST http://localhost:3001/api/solo/start   -H "Authorization: Bearer YOUR_JWT_TOKEN"   -H "Content-Type: application/json"   -d '{
    "characterName": "Thorin",
    "characterClass": "Fighter",
    "characterRace": "Dwarf"
  }'
```

Response:
```json
{
  "message": "Solo adventure started!",
  "campaign_id": "uuid-here",
  "character_id": "uuid-here",
  "mode": "solo",
  "ai_dm": false,
  "narration_source": "offline"
}
```

### 2. Take Actions

**Move to a new location:**
```bash
curl -X POST http://localhost:3001/api/solo/action   -H "Authorization: Bearer YOUR_JWT_TOKEN"   -d '{
    "campaign_id": "YOUR_CAMPAIGN_ID",
    "action": {
      "type": "move",
      "targetLocationId": "LOCATION_UUID"
    }
  }'
```

**Explore current area:**
```bash
curl -X POST http://localhost:3001/api/solo/action   -H "Authorization: Bearer YOUR_JWT_TOKEN"   -d '{
    "campaign_id": "YOUR_CAMPAIGN_ID",
    "action": { "type": "explore" }
  }'
```

**Start combat:**
```bash
curl -X POST http://localhost:3001/api/solo/action   -H "Authorization: Bearer YOUR_JWT_TOKEN"   -d '{
    "campaign_id": "YOUR_CAMPAIGN_ID",
    "action": { "type": "combat" }
  }'
```

**Rest and heal:**
```bash
curl -X POST http://localhost:3001/api/solo/action   -H "Authorization: Bearer YOUR_JWT_TOKEN"   -d '{
    "campaign_id": "YOUR_CAMPAIGN_ID",
    "action": { "type": "rest" }
  }'
```

**Interact with NPC:**
```bash
curl -X POST http://localhost:3001/api/solo/action   -H "Authorization: Bearer YOUR_JWT_TOKEN"   -d '{
    "campaign_id": "YOUR_CAMPAIGN_ID",
    "action": {
      "type": "interact",
      "targetId": "NPC_UUID"
    }
  }'
```

### 3. Check Game Status
```bash
curl http://localhost:3001/api/solo/status/YOUR_CAMPAIGN_ID   -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Returns full state:
```json
{
  "campaign": { "name": "Thorin's Solo Adventure", "locations": [...] },
  "character": { "name": "Thorin", "hp_current": 12, "level": 1 },
  "events": [...],
  "encyclopedia": ["Emberfall Village", "Eldric Ironhammer", ...],
  "ai_available": false,
  "encyclopedia_entries": 6
}
```

### 4. View Encyclopedia (In-Game Knowledge)
```bash
curl http://localhost:3001/api/solo/encyclopedia/YOUR_CAMPAIGN_ID   -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Integration Steps (For Developers)

### Step 1: Copy Files
```bash
cp soloEngine.ts apps/server/src/game/soloEngine.ts
cp soloRoutes.ts apps/server/src/routes/solo.ts
```

### Step 2: Update `apps/server/src/index.ts`

Add import:
```typescript
import soloRouter from "./routes/solo";
```

Add route (before `server.listen`):
```typescript
app.use("/api/solo", soloRouter);
```

Update health check to include solo status (see `index_modifications.md`).

### Step 3: No Environment Changes Required!

Solo mode works **without**:
- `GROQ_API_KEY` (uses offline narrations)
- WebSocket connections (uses REST polling)
- Human DM (automated enemy AI)
- Other players (self-contained campaign)

## Game Flow for Solo Player

```
[Start] → Create Fighter/Wizard/Rogue/etc.
   ↓
[Emberfall Village] → Meet NPCs (Blacksmith, Cleric, Scout)
   ↓
[Explore] → Skill checks, discover lore, find clues
   ↓
[Move] → Travel to Briarwood Wilds or Ashen Gate Ruins
   ↓
[Combat] → Auto-generated enemies, automated enemy turns
   ↓
[Rest] → Heal HP, trigger world events
   ↓
[Level Up] → Gain XP from combat/quests, improve stats
   ↓
[Quests] → "The Road to Adventure" auto-tracks progress
   ↓
[Encyclopedia] → Unlocks entries as you discover locations/NPCs
```

## Features That Work Immediately

| Feature | Solo Mode | Notes |
|---------|-----------|-------|
| Character Creation | ✅ | 6 classes, 6 races, starting equipment |
| Location Discovery | ✅ | 3 seeded locations with connections |
| NPC Interaction | ✅ | Relationship system, role-based dialogue |
| Combat | ✅ | Auto-AI enemies, initiative, death saves |
| Quests | ✅ | Auto-generated from templates |
| Encyclopedia | ✅ | Auto-seeded with 6+ entries |
| Narration | ✅ | 50+ offline narrations (no AI needed) |
| World Events | ✅ | Heartbeat system runs on rest |
| Leveling | ✅ | XP from combat, HP increases |
| Hidden Classes | ✅ | Tracks behavior, unlocks at thresholds |

## If You Add GROQ_API_KEY Later

Just set the environment variable:
```bash
export GROQ_API_KEY="your-key-here"
```

The solo engine automatically upgrades to AI narrations with more variety and context awareness. No code changes needed.

## Database Schema (Already Exists)

Solo mode uses your existing tables:
- `campaigns` → Solo campaigns marked with `solo_mode: true`
- `characters` → Player character
- `locations` → Auto-seeded with 3 areas
- `npcs` → Auto-seeded with 3 NPCs
- `quests` → Auto-generated from templates
- `event_log` → All actions logged with narration
- `encyclopedia_entries` → Auto-seeded with starter content
- `character_knowledge` → Tracks what player knows
- `combat_encounters` → Standard combat system
