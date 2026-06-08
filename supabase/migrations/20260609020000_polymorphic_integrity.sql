-- ============================================================
-- POLYMORPHIC INTEGRITY TRIGGERS MIGRATION
-- Enforces reference validation on polymorphic owner/target fields.
-- ============================================================

-- Trigger for faction_actions polymorphic integrity
CREATE OR REPLACE FUNCTION public.validate_faction_action_target()
RETURNS trigger AS $$
BEGIN
  IF NEW.target_id IS NOT NULL THEN
    CASE NEW.target_type
      WHEN 'location', 'trade_route' THEN
        IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = NEW.target_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: target_id % does not exist in locations table', NEW.target_id;
        END IF;
      WHEN 'npc' THEN
        IF NOT EXISTS (SELECT 1 FROM public.npcs WHERE id = NEW.target_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: target_id % does not exist in npcs table', NEW.target_id;
        END IF;
      WHEN 'faction' THEN
        IF NOT EXISTS (SELECT 1 FROM public.factions WHERE id = NEW.target_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: target_id % does not exist in factions table', NEW.target_id;
        END IF;
      WHEN 'player' THEN
        IF NOT EXISTS (SELECT 1 FROM public.characters WHERE id = NEW.target_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: target_id % does not exist in characters table', NEW.target_id;
        END IF;
      ELSE
        -- No validation for other types
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_faction_action_target ON public.faction_actions;
CREATE TRIGGER trg_validate_faction_action_target
  BEFORE INSERT OR UPDATE ON public.faction_actions
  FOR EACH ROW EXECUTE FUNCTION public.validate_faction_action_target();

-- Trigger for artifact_provenance polymorphic integrity
CREATE OR REPLACE FUNCTION public.validate_artifact_provenance_owner()
RETURNS trigger AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    CASE NEW.owner_type
      WHEN 'character' THEN
        IF NOT EXISTS (SELECT 1 FROM public.characters WHERE id = NEW.owner_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: owner_id % does not exist in characters table', NEW.owner_id;
        END IF;
      WHEN 'npc' THEN
        IF NOT EXISTS (SELECT 1 FROM public.npcs WHERE id = NEW.owner_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: owner_id % does not exist in npcs table', NEW.owner_id;
        END IF;
      WHEN 'faction' THEN
        IF NOT EXISTS (SELECT 1 FROM public.factions WHERE id = NEW.owner_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: owner_id % does not exist in factions table', NEW.owner_id;
        END IF;
      WHEN 'location' THEN
        IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = NEW.owner_id) THEN
          RAISE EXCEPTION 'Polymorphic integrity violation: owner_id % does not exist in locations table', NEW.owner_id;
        END IF;
      ELSE
        -- No validation for other types
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_artifact_provenance_owner ON public.artifact_provenance;
CREATE TRIGGER trg_validate_artifact_provenance_owner
  BEFORE INSERT OR UPDATE ON public.artifact_provenance
  FOR EACH ROW EXECUTE FUNCTION public.validate_artifact_provenance_owner();
