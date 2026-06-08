-- Migration to add missing index on encyclopedia_entries.era_id foreign key
CREATE INDEX IF NOT EXISTS encyclopedia_entries_era_idx ON public.encyclopedia_entries(era_id);
