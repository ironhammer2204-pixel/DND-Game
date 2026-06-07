-- ============================================================
-- ENCYCLOPEDIA SYSTEM MIGRATION
-- World Encyclopedia + Per-Character Knowledge + Rumors + Sessions
-- ============================================================

-- -------------------------------------------------------
-- encyclopedia_entries: master registry for all world objects
-- -------------------------------------------------------
create table public.encyclopedia_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  category text not null check (category in (
    'location','npc','faction','creature','item','religion',
    'language','technology','event','era','artifact','player'
  )),
  source_id uuid,             -- links to actual entity (npc id, location id, etc.)
  source_type text,           -- mirrors category for join logic
  title text not null,
  subtitle text,              -- e.g. "Merchant of the South"
  summary text,               -- short auto-generated blurb
  full_content jsonb not null default '{}'::jsonb,  -- structured per category
  importance int not null default 0,
  tags text[] not null default '{}',
  is_secret bool not null default false,   -- DM-only until revealed
  dm_notes text,                            -- private DM annotations
  custom_lore text,                         -- DM-written override content
  pinned bool not null default false,
  era_id uuid,                              -- links to historical era entry (self-ref below)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Self-reference for era_id added after table creation
alter table public.encyclopedia_entries
  add constraint fk_era_id
  foreign key (era_id) references public.encyclopedia_entries(id) on delete set null;

create trigger encyclopedia_entries_updated_at
before update on public.encyclopedia_entries
for each row execute function public.set_updated_at();

-- -------------------------------------------------------
-- character_knowledge: per-character discovery isolation
-- -------------------------------------------------------
create table public.character_knowledge (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  entry_id uuid not null references public.encyclopedia_entries(id) on delete cascade,
  knowledge_level int not null default 0 check (knowledge_level between 0 and 5),
  discovered_at timestamptz not null default now(),
  discovery_source text not null default 'dm_grant' check (discovery_source in (
    'exploration','combat','quest','npc_dialogue','item',
    'faction_event','dm_grant','rumor'
  )),
  updated_at timestamptz not null default now(),
  unique (character_id, entry_id)
);

create trigger character_knowledge_updated_at
before update on public.character_knowledge
for each row execute function public.set_updated_at();

-- -------------------------------------------------------
-- encyclopedia_history: in-game timeline events
-- -------------------------------------------------------
create table public.encyclopedia_history (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  entry_id uuid not null references public.encyclopedia_entries(id) on delete cascade,
  event_type text not null,  -- 'battle','assassination','founding','collapse','discovery','coronation', etc.
  title text not null,
  description text,
  year int,                  -- in-game year
  importance int not null default 0,
  involved_entry_ids uuid[] not null default '{}',  -- all entries involved
  source_type text not null default 'system' check (source_type in (
    'combat','faction','quest','dm','system'
  )),
  source_id uuid,            -- original event ID (combat_encounter_id, faction_action_id, etc.)
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- historical_eras: named eras of the campaign world
-- -------------------------------------------------------
create table public.historical_eras (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,        -- "Age of Expansion", "The Dark Years"
  start_year int,
  end_year int,              -- null = current era
  description text,
  trigger_event_id uuid references public.encyclopedia_history(id) on delete set null,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- rumors: rumors with source tracking and contradiction links
-- -------------------------------------------------------
create table public.rumors (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  entry_id uuid not null references public.encyclopedia_entries(id) on delete cascade,
  content text not null,
  reliability int not null default 50 check (reliability between 0 and 100),
  is_true bool,              -- null = unresolved
  source_type text not null default 'dm' check (source_type in (
    'npc','faction','player','dm','system'
  )),
  source_id uuid,
  spread_count int not null default 0,
  contradicts_rumor_id uuid references public.rumors(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- character_rumors: per-character rumor tracking
-- -------------------------------------------------------
create table public.character_rumors (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  rumor_id uuid not null references public.rumors(id) on delete cascade,
  heard_at timestamptz not null default now(),
  believed bool not null default true,
  unique (character_id, rumor_id)
);

-- -------------------------------------------------------
-- artifact_provenance: ownership chain for item entries
-- -------------------------------------------------------
create table public.artifact_provenance (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  item_entry_id uuid not null references public.encyclopedia_entries(id) on delete cascade,
  owner_type text not null check (owner_type in (
    'character','npc','faction','location','unknown'
  )),
  owner_id uuid,
  acquired_via text not null default 'found' check (acquired_via in (
    'found','purchased','stolen','gifted','crafted','quest','looted'
  )),
  year int,
  notes text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- session_records: session logs with AI summaries
-- -------------------------------------------------------
create table public.session_records (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_number int not null default 1,
  started_at timestamptz,
  ended_at timestamptz,
  player_character_ids uuid[] not null default '{}',
  event_ids uuid[] not null default '{}',
  ai_summary text,
  dm_notes text,
  summary_approved bool not null default false,
  importance int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index encyclopedia_entries_campaign_category_idx
  on public.encyclopedia_entries(campaign_id, category);

create index encyclopedia_entries_source_idx
  on public.encyclopedia_entries(source_type, source_id);

create index encyclopedia_entries_importance_idx
  on public.encyclopedia_entries(campaign_id, importance desc);

create index character_knowledge_character_idx
  on public.character_knowledge(character_id);

create index character_knowledge_entry_idx
  on public.character_knowledge(entry_id);

create index encyclopedia_history_campaign_year_idx
  on public.encyclopedia_history(campaign_id, year);

create index encyclopedia_history_entry_idx
  on public.encyclopedia_history(entry_id);

create index encyclopedia_history_importance_idx
  on public.encyclopedia_history(campaign_id, importance desc);

create index rumors_entry_idx
  on public.rumors(entry_id);

create index rumors_campaign_idx
  on public.rumors(campaign_id);

create index character_rumors_character_idx
  on public.character_rumors(character_id);

create index artifact_provenance_item_idx
  on public.artifact_provenance(item_entry_id);

create index session_records_campaign_idx
  on public.session_records(campaign_id, session_number desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.encyclopedia_entries enable row level security;
alter table public.character_knowledge enable row level security;
alter table public.encyclopedia_history enable row level security;
alter table public.historical_eras enable row level security;
alter table public.rumors enable row level security;
alter table public.character_rumors enable row level security;
alter table public.artifact_provenance enable row level security;
alter table public.session_records enable row level security;

-- encyclopedia_entries: members see non-secret entries; DM sees all
create policy "Members can read non-secret encyclopedia entries"
on public.encyclopedia_entries for select
using (
  public.is_campaign_member(campaign_id)
  and (is_secret = false or public.is_campaign_dm(campaign_id))
);

create policy "DMs can manage encyclopedia entries"
on public.encyclopedia_entries for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

-- character_knowledge: characters only see their own rows
create policy "Characters see own knowledge"
on public.character_knowledge for select
using (
  exists (
    select 1 from public.characters c
    where c.id = character_knowledge.character_id
      and c.user_id = auth.uid()
  )
  or public.is_campaign_dm(campaign_id)
);

create policy "Server can insert knowledge"
on public.character_knowledge for insert
with check (public.is_campaign_member(campaign_id));

create policy "Server can update knowledge"
on public.character_knowledge for update
using (public.is_campaign_member(campaign_id));

-- encyclopedia_history: members can read
create policy "Members can read encyclopedia history"
on public.encyclopedia_history for select
using (public.is_campaign_member(campaign_id));

create policy "Server can insert encyclopedia history"
on public.encyclopedia_history for insert
with check (public.is_campaign_member(campaign_id));

-- historical_eras: members can read
create policy "Members can read historical eras"
on public.historical_eras for select
using (public.is_campaign_member(campaign_id));

create policy "DMs can manage historical eras"
on public.historical_eras for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

-- rumors: members can read
create policy "Members can read rumors"
on public.rumors for select
using (public.is_campaign_member(campaign_id));

create policy "Server can manage rumors"
on public.rumors for all
using (public.is_campaign_member(campaign_id))
with check (public.is_campaign_member(campaign_id));

-- character_rumors: characters see own; DM sees all
create policy "Characters see own rumors"
on public.character_rumors for select
using (
  exists (
    select 1 from public.characters c
    join public.campaign_members cm on cm.campaign_id = c.campaign_id
    where c.id = character_rumors.character_id
      and cm.user_id = auth.uid()
  )
);

create policy "Server can manage character rumors"
on public.character_rumors for all
using (true)
with check (true);

-- artifact_provenance: members can read
create policy "Members can read artifact provenance"
on public.artifact_provenance for select
using (public.is_campaign_member(campaign_id));

create policy "Server can manage artifact provenance"
on public.artifact_provenance for all
using (public.is_campaign_member(campaign_id))
with check (public.is_campaign_member(campaign_id));

-- session_records: members can read approved summaries; DM sees all
create policy "Members can read approved session records"
on public.session_records for select
using (
  public.is_campaign_member(campaign_id)
  and (summary_approved = true or public.is_campaign_dm(campaign_id))
);

create policy "DMs can manage session records"
on public.session_records for all
using (public.is_campaign_dm(campaign_id))
with check (public.is_campaign_dm(campaign_id));

create policy "Server can insert session records"
on public.session_records for insert
with check (public.is_campaign_member(campaign_id));
