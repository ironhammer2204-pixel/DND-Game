-- ============================================================
-- MISSING BALANCE TABLES MIGRATION
-- balance_alerts and balance_overrides
-- ============================================================

CREATE TABLE IF NOT EXISTS public.balance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('economy', 'combat', 'loot', 'progression')),
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  message text NOT NULL,
  suggested_action text,
  resolved bool NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.balance_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  metric_type text NOT NULL,
  value float NOT NULL,
  reason text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_campaign_metric UNIQUE (campaign_id, metric_type)
);

CREATE INDEX IF NOT EXISTS balance_alerts_campaign_idx ON public.balance_alerts(campaign_id, resolved);
CREATE INDEX IF NOT EXISTS balance_overrides_campaign_idx ON public.balance_overrides(campaign_id);

ALTER TABLE public.balance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "DMs can manage balance alerts" ON public.balance_alerts FOR ALL USING (public.is_campaign_dm(campaign_id));
CREATE POLICY "DMs can manage balance overrides" ON public.balance_overrides FOR ALL USING (public.is_campaign_dm(campaign_id));
