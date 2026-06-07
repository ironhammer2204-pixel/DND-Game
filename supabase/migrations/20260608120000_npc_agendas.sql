-- Add NPC Agenda columns safely
do $$ 
begin 
  if not exists (select * from information_schema.columns where table_name='npcs' and column_name='short_term_goal') then
    alter table public.npcs add column short_term_goal text;
  end if;
  if not exists (select * from information_schema.columns where table_name='npcs' and column_name='long_term_goal') then
    alter table public.npcs add column long_term_goal text;
  end if;
  if not exists (select * from information_schema.columns where table_name='npcs' and column_name='secret') then
    alter table public.npcs add column secret text;
  end if;
  if not exists (select * from information_schema.columns where table_name='npcs' and column_name='secret_revealed') then
    alter table public.npcs add column secret_revealed boolean not null default false;
  end if;
  if not exists (select * from information_schema.columns where table_name='npcs' and column_name='agenda_state') then
    alter table public.npcs add column agenda_state jsonb not null default '{}'::jsonb;
  end if;

end $$;
