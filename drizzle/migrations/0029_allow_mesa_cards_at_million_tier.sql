-- THIS IS HOUSE MUSIC uses MESA cards for its 1,000,000 Kz / 8-person tier.
-- Keep BOX cards available at this price for other event configurations, but do not
-- force every 1,000,000 Kz group to use BOX.
CREATE OR REPLACE FUNCTION public.validate_event_table_card()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE g public.ticket_groups;
BEGIN
  SELECT * INTO g FROM public.ticket_groups WHERE id = NEW.group_id AND event_id = NEW.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O grupo selecionado não pertence a este evento';
  END IF;

  IF COALESCE(g.price, 0) <> 1000000 AND NEW.card_type = 'BOX' THEN
    RAISE EXCEPTION 'Cartões BOX são reservados à categoria de 1.000.000 Kz';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
