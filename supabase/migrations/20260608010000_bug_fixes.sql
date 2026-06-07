-- Migration: Bug Fixes
-- 1. Make npc_action_log.npc_id nullable (Bug M2)
-- 2. Normalise faction_relations pair direction (Bug M3)

-- ============================================================
-- Fix 1: Make npc_action_log.npc_id nullable
--   Previously system events inserted 00000000-0000-0000-0000-000000000000
--   which FK-violates against public.npcs(id). Now system rows can use NULL.
-- ============================================================
ALTER TABLE public.npc_action_log
  ALTER COLUMN npc_id DROP NOT NULL;

-- ============================================================
-- Fix 2: Normalise faction_relations pair direction
--   The old unique constraint unique_faction_pair(campaign_id, faction_a_id, faction_b_id)
--   is directional: (A,B) and (B,A) can both exist as separate rows.
--   Drop the old constraint and replace with a LEAST/GREATEST unique index.
-- ============================================================

-- Step 1: Remove duplicate reverse-direction pairs, keeping the row with the lower id
DELETE FROM public.faction_relations a
USING public.faction_relations b
WHERE a.campaign_id = b.campaign_id
  AND a.faction_a_id = b.faction_b_id
  AND a.faction_b_id = b.faction_a_id
  AND a.id > b.id;

-- Step 2: Drop the old directional unique constraint
ALTER TABLE public.faction_relations
  DROP CONSTRAINT IF EXISTS unique_faction_pair;

-- Step 3: Create a new normalised unique index using LEAST/GREATEST
--   Postgres does not support expressions in UNIQUE constraints, so we use an index.
CREATE UNIQUE INDEX unique_faction_pair
  ON public.faction_relations (
    campaign_id,
    LEAST(faction_a_id::text, faction_b_id::text),
    GREATEST(faction_a_id::text, faction_b_id::text)
  );
