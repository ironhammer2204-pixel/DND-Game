-- ============================================================
-- DROP UNUSED RUMOURS TABLE MIGRATION
-- Drop the redundant British-spelling rumours table.
-- ============================================================

DROP POLICY IF EXISTS "Members can read rumours" ON public.rumours;
DROP POLICY IF EXISTS "DMs can manage rumours" ON public.rumours;
DROP TABLE IF EXISTS public.rumours CASCADE;
