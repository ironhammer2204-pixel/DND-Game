-- Add NPC Agenda columns
alter table public.npcs
add column short_term_goal text,
add column long_term_goal text,
add column secret text,
add column secret_revealed boolean not null default false,
add column agenda_state jsonb not null default '{}'::jsonb;
