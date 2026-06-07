-- ============================================================
-- BALANCING ENGINE MIGRATION
-- Economy, Combat, Loot, Faction, Progression metrics
-- ============================================================

-- -------------------------------------------------------
-- balance_snapshots: full metric snapshots with flags
-- -------------------------------------------------------
create table public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  snapshot_type text not null check (snapshot_type in (
    'economy','combat','faction','loot','progression'
  )),
  data jsonb not null default '{}'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '{}'::jsonb,
  applied bool not null default false,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- economy_metrics: per-cycle gold/inflation tracking
-- -------------------------------------------------------
create table public.economy_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  cycle_number int not null default 1,
  total_gold_in_circulation int not null default 0,
  gold_generated_this_cycle int not null default 0,
  gold_sunk_this_cycle int not null default 0,
  inflation_index float not null default 1.0,
  avg_player_wealth int not null default 0,
  wealth_gini float not null default 0.0,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- combat_metrics: per-cycle combat performance stats
-- -------------------------------------------------------
create table public.combat_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  cycle_number int not null default 1,
  avg_combat_duration_rounds float not null default 0,
  avg_player_damage_per_round float not null default 0,
  avg_enemy_damage_per_round float not null default 0,
  win_rate float not null default 0.5,
  death_rate float not null default 0.0,
  most_used_build_types jsonb not null default '{}'::jsonb,
  dominant_build_percent float not null default 0.0,
  sessions_sampled int not null default 0,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- loot_metrics: per-item drop/use/sell ratios
-- -------------------------------------------------------
create table public.loot_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  cycle_number int not null default 1,
  item_id text not null,
  drop_count int not null default 0,
  usage_count int not null default 0,
  sell_count int not null default 0,
  current_drop_rate float not null default 1.0,
  recommended_drop_rate float not null default 1.0,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- progression_metrics: level distribution + soft cap triggers
-- -------------------------------------------------------
create table public.progression_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  cycle_number int not null default 1,
  avg_character_level float not null default 1.0,
  xp_per_session_avg float not null default 0.0,
  level_distribution jsonb not null default '{}'::jsonb,
  soft_cap_triggers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index balance_snapshots_campaign_type_idx
  on public.balance_snapshots(campaign_id, snapshot_type, created_at desc);

create index economy_metrics_campaign_cycle_idx
  on public.economy_metrics(campaign_id, cycle_number desc);

create index combat_metrics_campaign_cycle_idx
  on public.combat_metrics(campaign_id, cycle_number desc);

create index loot_metrics_campaign_item_idx
  on public.loot_metrics(campaign_id, item_id, cycle_number desc);

create index progression_metrics_campaign_cycle_idx
  on public.progression_metrics(campaign_id, cycle_number desc);

-- ============================================================
-- ROW LEVEL SECURITY (DM-only for all balance data)
-- ============================================================
alter table public.balance_snapshots enable row level security;
alter table public.economy_metrics enable row level security;
alter table public.combat_metrics enable row level security;
alter table public.loot_metrics enable row level security;
alter table public.progression_metrics enable row level security;

create policy "DMs can read balance snapshots"
on public.balance_snapshots for select
using (public.is_campaign_dm(campaign_id));

create policy "Server can insert balance snapshots"
on public.balance_snapshots for insert
with check (public.is_campaign_member(campaign_id));

create policy "DMs can update balance snapshots"
on public.balance_snapshots for update
using (public.is_campaign_dm(campaign_id));

create policy "DMs can read economy metrics"
on public.economy_metrics for select
using (public.is_campaign_dm(campaign_id));

create policy "Server can insert economy metrics"
on public.economy_metrics for insert
with check (public.is_campaign_member(campaign_id));

create policy "DMs can read combat metrics"
on public.combat_metrics for select
using (public.is_campaign_dm(campaign_id));

create policy "Server can insert combat metrics"
on public.combat_metrics for insert
with check (public.is_campaign_member(campaign_id));

create policy "DMs can read loot metrics"
on public.loot_metrics for select
using (public.is_campaign_dm(campaign_id));

create policy "Server can insert loot metrics"
on public.loot_metrics for insert
with check (public.is_campaign_member(campaign_id));

create policy "DMs can read progression metrics"
on public.progression_metrics for select
using (public.is_campaign_dm(campaign_id));

create policy "Server can insert progression metrics"
on public.progression_metrics for insert
with check (public.is_campaign_member(campaign_id));
