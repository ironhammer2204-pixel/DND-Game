-- ============================================================
-- FIX PLAN DATABASE MIGRATION
-- RLS Fixes, Missing Indexes, Auth Trigger Sync, & Pressure Constraints
-- ============================================================

-- ------------------------------------------------------------
-- P1.1: Fix RLS Security Holes
-- ------------------------------------------------------------

-- Fix character_behaviour_profile INSERT policy
DROP POLICY IF EXISTS "System can insert behaviour profile" ON public.character_behaviour_profile;

CREATE POLICY "System can insert behaviour profile"
ON public.character_behaviour_profile FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = character_behaviour_profile.character_id
    AND (c.user_id = auth.uid() OR public.is_campaign_dm(c.campaign_id))
  )
);

-- Fix character_rumors policy
DROP POLICY IF EXISTS "Server can manage character rumors" ON public.character_rumors;

CREATE POLICY "Players can manage own character rumors"
ON public.character_rumors FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = character_rumors.character_id
    AND c.user_id = auth.uid()
  )
);

CREATE POLICY "DMs can manage all character rumors"
ON public.character_rumors FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = character_rumors.character_id
    AND public.is_campaign_dm(c.campaign_id)
  )
);

-- ------------------------------------------------------------
-- P1.2: Add Missing Database Indexes
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS npcs_location_campaign_idx 
ON public.npcs(location_id, campaign_id);

CREATE INDEX IF NOT EXISTS encyclopedia_entries_secret_idx 
ON public.encyclopedia_entries(is_secret);

CREATE INDEX IF NOT EXISTS combat_encounters_campaign_idx 
ON public.combat_encounters(campaign_id);

CREATE INDEX IF NOT EXISTS quests_giver_npc_idx 
ON public.quests(giver_npc_id);

-- ------------------------------------------------------------
-- P1.3: Fix Auth Trigger Sync (ON UPDATE)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_user_update()
RETURNS trigger AS $$
BEGIN
  UPDATE public.users
  SET email = new.email,
      username = COALESCE(
        new.raw_user_meta_data->>'username',
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        SPLIT_PART(new.email, '@', 1)
      ),
      avatar_url = new.raw_user_meta_data->>'avatar_url'
  WHERE id = new.id;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_user_update();

-- ------------------------------------------------------------
-- P1.5: Add DB Constraint for Faction Pressure
-- ------------------------------------------------------------

-- Keep existing pressure values under constraint or cap them first
UPDATE public.factions SET pressure = LEAST(pressure, pressure_cap);

ALTER TABLE public.factions
DROP CONSTRAINT IF EXISTS pressure_within_cap;

ALTER TABLE public.factions
ADD CONSTRAINT pressure_within_cap 
CHECK (pressure <= pressure_cap);
