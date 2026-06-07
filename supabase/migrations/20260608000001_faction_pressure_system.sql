-- Alter factions table to add the new faction simulation fields
alter table public.factions
  add column if not exists type text not null default 'neutral' check (type in ('empire','merchant','cult','rebel','criminal','secret','neutral')),
  add column if not exists is_hidden bool not null default false,
  add column if not exists military int not null default 0 check (military >= 0),
  add column if not exists wealth int not null default 0 check (wealth >= 0),
  add column if not exists influence int not null default 0 check (influence >= 0),
  add column if not exists stability int not null default 100 check (stability >= 0 and stability <= 100),
  add column if not exists pressure int not null default 0 check (pressure >= 0),
  add column if not exists pressure_cap int not null default 2000 check (pressure_cap >= 0),
  add column if not exists territories int not null default 0 check (territories >= 0),
  add column if not exists personality text not null default 'defensive' check (personality in ('expansionist','merchant','religious','revolutionary','defensive','isolationist')),
  add column if not exists objectives jsonb not null default '[]'::jsonb,
  add column if not exists victory_condition jsonb not null default '{}'::jsonb,
  add column if not exists is_victorious bool not null default false,
  add column if not exists collapsed bool not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Ensure factions triggers set updated_at
create trigger factions_set_updated_at
before update on public.factions
for each row
execute function public.set_updated_at();

-- Faction Relations table
create table if not exists public.faction_relations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  faction_a_id uuid not null references public.factions(id) on delete cascade,
  faction_b_id uuid not null references public.factions(id) on delete cascade,
  score int not null default 0 check (score >= -100 and score <= 100),
  treaty_type text not null default 'none' check (treaty_type in ('none','truce','trade','alliance','vassalage')),
  treaty_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint unique_faction_pair unique (campaign_id, faction_a_id, faction_b_id)
);

-- Faction Territories table
create table if not exists public.faction_territories (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  faction_id uuid not null references public.factions(id) on delete cascade,
  pressure_value int not null default 0 check (pressure_value >= 0),
  control_percent int not null default 0 check (control_percent >= 0 and control_percent <= 100),
  is_claimed bool not null default false,
  updated_at timestamptz not null default now(),
  constraint unique_faction_location unique (campaign_id, location_id, faction_id)
);

-- Faction Actions table
create table if not exists public.faction_actions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  faction_id uuid not null references public.factions(id) on delete cascade,
  action_type text not null,
  target_type text not null check (target_type in ('location','npc','faction','trade_route','player')),
  target_id uuid not null,
  pressure_cost int not null default 0 check (pressure_cost >= 0),
  status text not null default 'pending' check (status in ('pending','resolved','vetoed','countered')),
  result jsonb not null default '{}'::jsonb,
  cooldown_until timestamptz,
  triggered_by text not null default 'engine' check (triggered_by in ('engine','dm','player_action','cascade')),
  parent_action_id uuid references public.faction_actions(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Faction Pressure Log table
create table if not exists public.faction_pressure_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  faction_id uuid not null references public.factions(id) on delete cascade,
  cycle_number int not null default 0 check (cycle_number >= 0),
  pressure_generated int not null default 0 check (pressure_generated >= 0),
  pressure_spent int not null default 0 check (pressure_spent >= 0),
  pressure_decayed int not null default 0 check (pressure_decayed >= 0),
  actions_taken jsonb not null default '[]'::jsonb,
  logged_at timestamptz not null default now()
);

-- Player Faction Reputation table
create table if not exists public.player_faction_reputation (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  faction_id uuid not null references public.factions(id) on delete cascade,
  score int not null default 0 check (score >= -100 and score <= 100),
  tier text not null default 'unknown' check (tier in ('unknown','watched','wanted','hunted','champion','legend')),
  bounty_amount int not null default 0 check (bounty_amount >= 0),
  updated_at timestamptz not null default now(),
  constraint unique_character_faction unique (campaign_id, character_id, faction_id)
);

-- NPC Faction Alignment table
create table if not exists public.npc_faction_alignment (
  id uuid primary key default gen_random_uuid(),
  npc_id uuid not null references public.npcs(id) on delete cascade,
  faction_id uuid not null references public.factions(id) on delete cascade,
  alignment_score int not null default 0 check (alignment_score >= -100 and alignment_score <= 100),
  is_agent bool not null default false,
  updated_at timestamptz not null default now(),
  constraint unique_npc_faction unique (npc_id, faction_id)
);

-- Create triggers to auto-update updated_at fields
create trigger faction_relations_set_updated_at
before update on public.faction_relations
for each row execute function public.set_updated_at();

create trigger faction_territories_set_updated_at
before update on public.faction_territories
for each row execute function public.set_updated_at();

create trigger player_faction_reputation_set_updated_at
before update on public.player_faction_reputation
for each row execute function public.set_updated_at();

create trigger npc_faction_alignment_set_updated_at
before update on public.npc_faction_alignment
for each row execute function public.set_updated_at();

-- Indexes for performance
create index if not exists faction_territories_location_idx on public.faction_territories(location_id);
create index if not exists faction_territories_faction_idx on public.faction_territories(faction_id);
create index if not exists faction_actions_status_idx on public.faction_actions(status);
create index if not exists faction_actions_cooldown_idx on public.faction_actions(cooldown_until);
create index if not exists player_faction_rep_character_idx on public.player_faction_reputation(character_id);
create index if not exists faction_relations_pair_idx on public.faction_relations(campaign_id, faction_a_id, faction_b_id);

-- Enable RLS on all tables
alter table public.faction_relations enable row level security;
alter table public.faction_territories enable row level security;
alter table public.faction_actions enable row level security;
alter table public.faction_pressure_log enable row level security;
alter table public.player_faction_reputation enable row level security;
alter table public.npc_faction_alignment enable row level security;

-- Setup RLS Policies

-- faction_relations
create policy "Members can read relations"
on public.faction_relations for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage relations"
on public.faction_relations for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

-- faction_territories
create policy "Members can read territories"
on public.faction_territories for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage territories"
on public.faction_territories for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

-- faction_actions
create policy "Members can read non-secret faction actions"
on public.faction_actions for select
using (
  public.is_campaign_member(campaign_id)
  and not exists (
    select 1 from public.factions f
    where f.id = faction_id and f.is_hidden = true
  )
);

create policy "DMs can manage faction actions"
on public.faction_actions for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

-- faction_pressure_log
create policy "Members can read pressure logs"
on public.faction_pressure_log for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage pressure logs"
on public.faction_pressure_log for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

-- player_faction_reputation
create policy "Members can read player reputations"
on public.player_faction_reputation for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage player reputations"
on public.player_faction_reputation for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

-- npc_faction_alignment
create policy "Members can read npc alignments"
on public.npc_faction_alignment for select
using (
  exists (
    select 1 from public.npcs n
    where n.id = npc_id and public.is_campaign_member(n.campaign_id)
  )
);

create policy "DMs can manage npc alignments"
on public.npc_faction_alignment for all
using (
  exists (
    select 1 from public.npcs n
    where n.id = npc_id and public.is_campaign_dm(n.campaign_id)
  )
)
with check (
  exists (
    select 1 from public.npcs n
    where n.id = npc_id and public.is_campaign_dm(n.campaign_id)
  )
);
