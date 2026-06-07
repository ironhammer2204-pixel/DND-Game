create table if not exists public.factions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  disposition text not null default 'hostile' check (disposition in ('hostile','neutral','rival','allied')),
  power_level int not null default 1 check (power_level >= 1),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.nemeses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_monster_id text,
  name text not null,
  epithet text,
  tier text not null default 'soldier' check (tier in ('soldier','lieutenant','warlord','archnemesis')),
  status text not null default 'active' check (status in ('active','dead','retired','missing','ambushing')),
  level int not null default 1 check (level >= 1),
  xp int not null default 0 check (xp >= 0),
  personality text not null default 'brutal',
  traits jsonb not null default '{}'::jsonb,
  tactics jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  scars jsonb not null default '[]'::jsonb,
  appearance jsonb not null default '{}'::jsonb,
  faction_id uuid references public.factions(id) on delete set null,
  minion_ids uuid[] not null default '{}',
  location_id uuid references public.locations(id) on delete set null,
  target_character_id uuid references public.characters(id) on delete set null,
  grudge_score int not null default 0 check (grudge_score >= 0),
  bounty_on_party int not null default 0 check (bounty_on_party >= 0),
  successor_nemesis_id uuid references public.nemeses(id) on delete set null,
  promoted_from_nemesis_id uuid references public.nemeses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.nemesis_history (
  id uuid primary key default gen_random_uuid(),
  nemesis_id uuid not null references public.nemeses(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  encounter_id uuid references public.combat_encounters(id) on delete set null,
  event_type text not null,
  actor_character_id uuid references public.characters(id) on delete set null,
  summary text not null,
  mechanical_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists factions_campaign_idx on public.factions(campaign_id);
create index if not exists nemeses_campaign_status_idx on public.nemeses(campaign_id, status);
create index if not exists nemeses_target_character_idx on public.nemeses(target_character_id);
create index if not exists nemeses_faction_idx on public.nemeses(faction_id);
create index if not exists nemesis_history_nemesis_time_idx on public.nemesis_history(nemesis_id, occurred_at desc);

create trigger nemeses_set_updated_at
before update on public.nemeses
for each row
execute function public.set_updated_at();

alter table public.factions enable row level security;
alter table public.nemeses enable row level security;
alter table public.nemesis_history enable row level security;

create policy "Members can read factions"
on public.factions for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage factions"
on public.factions for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Members can read nemeses"
on public.nemeses for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage nemeses"
on public.nemeses for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Members can read nemesis history"
on public.nemesis_history for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage nemesis history"
on public.nemesis_history for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));
