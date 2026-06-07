-- Campaigns flags
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS world_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- NPC upgrade
ALTER TABLE public.npcs ADD COLUMN IF NOT EXISTS urgency int NOT NULL DEFAULT 1;
ALTER TABLE public.npcs ADD COLUMN IF NOT EXISTS power_level int NOT NULL DEFAULT 1;
ALTER TABLE public.npcs ADD COLUMN IF NOT EXISTS short_term_goal text;
ALTER TABLE public.npcs ADD COLUMN IF NOT EXISTS long_term_goal text;
ALTER TABLE public.npcs ADD COLUMN IF NOT EXISTS secret text;
ALTER TABLE public.npcs ADD COLUMN IF NOT EXISTS agenda_state jsonb NOT NULL DEFAULT '{}'::jsonb;

-- npc_relationships table
CREATE TABLE IF NOT EXISTS public.npc_relationships (
  npc_id uuid NOT NULL REFERENCES public.npcs(id) ON DELETE CASCADE,
  target_npc_id uuid NOT NULL REFERENCES public.npcs(id) ON DELETE CASCADE,
  trust int NOT NULL DEFAULT 50 CHECK (trust >= 0 AND trust <= 100),
  fear int NOT NULL DEFAULT 50 CHECK (fear >= 0 AND fear <= 100),
  owes text,
  PRIMARY KEY (npc_id, target_npc_id)
);

-- rumours table
CREATE TABLE IF NOT EXISTS public.rumours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  text text NOT NULL,
  source_npc_id uuid REFERENCES public.npcs(id) ON DELETE SET NULL,
  is_discovered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- npc_action_log table
CREATE TABLE IF NOT EXISTS public.npc_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  npc_id uuid NOT NULL REFERENCES public.npcs(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- character_behaviour_log table
CREATE TABLE IF NOT EXISTS public.character_behaviour_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  tags text[] NOT NULL,
  weight int NOT NULL DEFAULT 1 CHECK (weight >= 1),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- character_behaviour_profile table
CREATE TABLE IF NOT EXISTS public.character_behaviour_profile (
  character_id uuid PRIMARY KEY REFERENCES public.characters(id) ON DELETE CASCADE,
  tag_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- character_classes table (supports multiple classes per character, many-to-many)
CREATE TABLE IF NOT EXISTS public.character_classes (
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  class_type text NOT NULL CHECK (class_type IN ('primary', 'hidden')),
  class_name text NOT NULL,
  class_level int NOT NULL DEFAULT 1 CHECK (class_level >= 1),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  unlock_story text,
  PRIMARY KEY (character_id, class_name)
);

-- consequence_arc_log table
CREATE TABLE IF NOT EXISTS public.consequence_arc_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  character_id uuid REFERENCES public.characters(id) ON DELETE CASCADE,
  arc_id text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS rumours_campaign_idx ON public.rumours(campaign_id);
CREATE INDEX IF NOT EXISTS npc_action_log_campaign_idx ON public.npc_action_log(campaign_id);
CREATE INDEX IF NOT EXISTS character_behaviour_log_char_idx ON public.character_behaviour_log(character_id);
CREATE INDEX IF NOT EXISTS consequence_arc_log_campaign_idx ON public.consequence_arc_log(campaign_id);

-- Enable RLS
ALTER TABLE public.npc_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rumours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npc_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_behaviour_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_behaviour_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consequence_arc_log ENABLE ROW LEVEL SECURITY;

-- Policies (following standard campaign-member and campaign-dm logic)

-- npc_relationships
CREATE POLICY "Members can read npc_relationships" ON public.npc_relationships
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.npcs n 
      WHERE n.id = npc_relationships.npc_id 
        AND public.is_campaign_member(n.campaign_id)
    )
  );
CREATE POLICY "DMs can manage npc_relationships" ON public.npc_relationships
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.npcs n 
      WHERE n.id = npc_relationships.npc_id 
        AND public.is_campaign_dm(n.campaign_id)
    )
  );

-- rumours
CREATE POLICY "Members can read rumours" ON public.rumours
  FOR SELECT USING (public.is_campaign_member(campaign_id));
CREATE POLICY "DMs can manage rumours" ON public.rumours
  FOR ALL USING (public.is_campaign_dm(campaign_id));

-- npc_action_log
CREATE POLICY "Members can read npc_action_log" ON public.npc_action_log
  FOR SELECT USING (public.is_campaign_member(campaign_id));
CREATE POLICY "DMs can manage npc_action_log" ON public.npc_action_log
  FOR ALL USING (public.is_campaign_dm(campaign_id));

-- character_behaviour_log
CREATE POLICY "Members can read character_behaviour_log" ON public.character_behaviour_log
  FOR SELECT USING (public.is_campaign_member(campaign_id));
CREATE POLICY "Members can insert behaviour log" ON public.character_behaviour_log
  FOR INSERT WITH CHECK (public.is_campaign_member(campaign_id));
CREATE POLICY "DMs can manage behaviour log" ON public.character_behaviour_log
  FOR ALL USING (public.is_campaign_dm(campaign_id));

-- character_behaviour_profile
CREATE POLICY "Members can read character_behaviour_profile" ON public.character_behaviour_profile
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.id = character_behaviour_profile.character_id
        AND public.is_campaign_member(c.campaign_id)
    )
  );
CREATE POLICY "Owners or DMs can update behaviour profile" ON public.character_behaviour_profile
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.id = character_behaviour_profile.character_id
        AND (c.user_id = auth.uid() OR public.is_campaign_dm(c.campaign_id))
    )
  );
CREATE POLICY "System can insert behaviour profile" ON public.character_behaviour_profile
  FOR INSERT WITH CHECK (true);

-- character_classes
CREATE POLICY "Members can read character_classes" ON public.character_classes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.id = character_classes.character_id
        AND public.is_campaign_member(c.campaign_id)
    )
  );
CREATE POLICY "Owners or DMs can update character_classes" ON public.character_classes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.id = character_classes.character_id
        AND (c.user_id = auth.uid() OR public.is_campaign_dm(c.campaign_id))
    )
  );

-- consequence_arc_log
CREATE POLICY "Members can read consequence_arc_log" ON public.consequence_arc_log
  FOR SELECT USING (public.is_campaign_member(campaign_id));
CREATE POLICY "DMs can manage consequence_arc_log" ON public.consequence_arc_log
  FOR ALL USING (public.is_campaign_dm(campaign_id));
