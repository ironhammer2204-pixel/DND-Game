create extension if not exists pgcrypto;

create type public.campaign_role as enum ('player', 'dm');
create type public.quest_type as enum ('main', 'side', 'random');
create type public.quest_status as enum ('active', 'complete', 'failed');
create type public.combat_status as enum ('active', 'resolved');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  owner_id uuid not null references public.users(id) on delete cascade,
  world_state jsonb not null default '{}'::jsonb,
  session_count int not null default 0 check (session_count >= 0),
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  type text,
  description text,
  state jsonb not null default '{}'::jsonb,
  connected_locations uuid[] not null default '{}',
  lore text
);

create table public.item_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text,
  description text,
  stats jsonb not null default '{}'::jsonb,
  value_gp int not null default 0 check (value_gp >= 0),
  is_consumable boolean not null default false
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  race text not null,
  class text not null,
  level int not null default 1 check (level >= 1),
  xp int not null default 0 check (xp >= 0),
  hp_current int not null check (hp_current >= 0),
  hp_max int not null check (hp_max > 0),
  attributes jsonb not null,
  skills jsonb not null,
  gold int not null default 0 check (gold >= 0),
  reputation jsonb not null default '{}'::jsonb,
  is_alive boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  role public.campaign_role not null default 'player',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  item_id uuid not null references public.item_catalog(id),
  quantity int not null default 1 check (quantity > 0),
  is_equipped boolean not null default false,
  acquired_at timestamptz not null default now()
);

create table public.npcs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  role text,
  location_id uuid references public.locations(id) on delete set null,
  is_alive boolean not null default true,
  relationship_map jsonb not null default '{}'::jsonb,
  known_info jsonb not null default '[]'::jsonb,
  memory_log jsonb not null default '[]'::jsonb,
  base_stats jsonb not null
);

create table public.quests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  type public.quest_type not null,
  title text not null,
  description text,
  status public.quest_status not null default 'active',
  objectives jsonb not null,
  rewards jsonb not null default '{}'::jsonb,
  giver_npc_id uuid references public.npcs(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.combat_encounters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  status public.combat_status not null default 'active',
  turn_order jsonb not null,
  current_turn_index int not null default 0 check (current_turn_index >= 0),
  participants jsonb not null,
  round_number int not null default 1 check (round_number >= 1),
  started_at timestamptz not null default now()
);

create table public.event_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  type text not null,
  actor_id uuid,
  payload jsonb not null,
  ai_narration text,
  created_at timestamptz not null default now()
);

create table public.dice_rolls (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  dice_type text not null check (dice_type in ('d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100')),
  raw_value int not null check (raw_value > 0),
  modifier int not null default 0,
  final_value int not null,
  context text,
  rolled_at timestamptz not null default now()
);

create index campaigns_owner_id_idx on public.campaigns(owner_id);
create index campaigns_invite_code_idx on public.campaigns(invite_code);
create index campaign_members_user_id_idx on public.campaign_members(user_id);
create index characters_campaign_id_idx on public.characters(campaign_id);
create index characters_user_id_idx on public.characters(user_id);
create index event_log_campaign_created_idx on public.event_log(campaign_id, created_at desc);
create index dice_rolls_campaign_rolled_idx on public.dice_rolls(campaign_id, rolled_at desc);
create index inventory_items_character_id_idx on public.inventory_items(character_id);
create index npcs_campaign_id_idx on public.npcs(campaign_id);
create index quests_campaign_status_idx on public.quests(campaign_id, status);
create index locations_campaign_id_idx on public.locations(campaign_id);
create index combat_encounters_campaign_status_idx on public.combat_encounters(campaign_id, status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger characters_set_updated_at
before update on public.characters
for each row
execute function public.set_updated_at();

create or replace function public.is_campaign_member(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = target_campaign_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.is_campaign_dm(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = target_campaign_id
      and cm.user_id = auth.uid()
      and cm.role = 'dm'
  );
$$;

alter table public.users enable row level security;
alter table public.campaigns enable row level security;
alter table public.locations enable row level security;
alter table public.item_catalog enable row level security;
alter table public.characters enable row level security;
alter table public.campaign_members enable row level security;
alter table public.inventory_items enable row level security;
alter table public.npcs enable row level security;
alter table public.quests enable row level security;
alter table public.combat_encounters enable row level security;
alter table public.event_log enable row level security;
alter table public.dice_rolls enable row level security;

create policy "Users can read own profile"
on public.users for select
using (id = auth.uid());

create policy "Users can insert own profile"
on public.users for insert
with check (id = auth.uid());

create policy "Users can update own profile"
on public.users for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "Members can read campaigns"
on public.campaigns for select
using (public.is_campaign_member(id) or owner_id = auth.uid());

create policy "Users can create campaigns"
on public.campaigns for insert
with check (owner_id = auth.uid());

create policy "DMs can update campaigns"
on public.campaigns for update
using (public.is_campaign_dm(id) or owner_id = auth.uid())
with check (public.is_campaign_dm(id) or owner_id = auth.uid());

create policy "Members can read campaign members"
on public.campaign_members for select
using (public.is_campaign_member(campaign_id));

create policy "Users can join campaigns as themselves"
on public.campaign_members for insert
with check (user_id = auth.uid());

create policy "Members can update their presence"
on public.campaign_members for update
using (user_id = auth.uid() or public.is_campaign_dm(campaign_id))
with check (user_id = auth.uid() or public.is_campaign_dm(campaign_id));

create policy "Members can read characters"
on public.characters for select
using (public.is_campaign_member(campaign_id));

create policy "Users can create own characters"
on public.characters for insert
with check (user_id = auth.uid() and public.is_campaign_member(campaign_id));

create policy "Users or DMs can update characters"
on public.characters for update
using (user_id = auth.uid() or public.is_campaign_dm(campaign_id))
with check (user_id = auth.uid() or public.is_campaign_dm(campaign_id));

create policy "Members can read locations"
on public.locations for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage locations"
on public.locations for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Authenticated users can read item catalog"
on public.item_catalog for select
to authenticated
using (true);

create policy "Members can read inventory"
on public.inventory_items for select
using (
  exists (
    select 1
    from public.characters c
    where c.id = inventory_items.character_id
      and public.is_campaign_member(c.campaign_id)
  )
);

create policy "Owners or DMs can manage inventory"
on public.inventory_items for all
using (
  exists (
    select 1
    from public.characters c
    where c.id = inventory_items.character_id
      and (c.user_id = auth.uid() or public.is_campaign_dm(c.campaign_id))
  )
)
with check (
  exists (
    select 1
    from public.characters c
    where c.id = inventory_items.character_id
      and (c.user_id = auth.uid() or public.is_campaign_dm(c.campaign_id))
  )
);

create policy "Members can read NPCs"
on public.npcs for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage NPCs"
on public.npcs for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Members can read quests"
on public.quests for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage quests"
on public.quests for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Members can read combat encounters"
on public.combat_encounters for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage combat encounters"
on public.combat_encounters for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Members can read event log"
on public.event_log for select
using (public.is_campaign_member(campaign_id));

create policy "Members can create event log rows"
on public.event_log for insert
with check (public.is_campaign_member(campaign_id));

create policy "DMs can update event narration"
on public.event_log for update
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Members can read dice rolls"
on public.dice_rolls for select
using (public.is_campaign_member(campaign_id));

create policy "Character owners can create dice rolls"
on public.dice_rolls for insert
with check (
  exists (
    select 1
    from public.characters c
    where c.id = dice_rolls.character_id
      and c.campaign_id = dice_rolls.campaign_id
      and c.user_id = auth.uid()
  )
);
