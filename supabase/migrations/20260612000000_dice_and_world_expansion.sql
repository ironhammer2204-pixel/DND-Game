-- Migration: Dice & World Expansion
-- Applied: 2026-06-12

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS ability_scores JSONB NOT NULL DEFAULT
    '{"strength":10,"dexterity":10,"constitution":10,"intelligence":10,"wisdom":10,"charisma":10}',
  ADD COLUMN IF NOT EXISTS proficiencies TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS saving_throw_proficiencies TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS current_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_status_check'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_status_check
      CHECK (status IN ('setup', 'active', 'paused', 'completed'));
  END IF;
END $$;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS danger_level TEXT NOT NULL DEFAULT 'medium';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_danger_level_check'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_danger_level_check
      CHECK (danger_level IN ('safe', 'low', 'medium', 'high', 'deadly'));
  END IF;
END $$;

ALTER TABLE public.quests
  ADD COLUMN IF NOT EXISTS current_objective TEXT;

ALTER TABLE public.npcs
  ADD COLUMN IF NOT EXISTS archetype TEXT;

CREATE INDEX IF NOT EXISTS characters_campaign_user_idx
  ON public.characters(campaign_id, user_id);

CREATE INDEX IF NOT EXISTS locations_campaign_idx
  ON public.locations(campaign_id);

CREATE INDEX IF NOT EXISTS event_log_campaign_type_idx
  ON public.event_log(campaign_id, type);
