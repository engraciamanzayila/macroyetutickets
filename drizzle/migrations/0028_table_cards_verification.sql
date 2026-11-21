-- Table ID cards are the source of truth; physical printed identifiers are assigned to cards.
DROP FUNCTION IF EXISTS public.verify_table_card(text);

ALTER TABLE public.tickets DROP COLUMN IF EXISTS table_capacity;

CREATE TABLE IF NOT EXISTS public.event_table_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.ticket_groups(id) ON DELETE RESTRICT,
  card_type text NOT NULL CHECK (card_type IN ('MESA', 'BOX')),
  card_number integer NOT NULL CHECK (card_number BETWEEN 1 AND 1000),
  holder_name text,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
  physical_identifier_type text CHECK (physical_identifier_type IN ('MESA', 'BOX')),
  physical_identifier_number integer CHECK (physical_identifier_number BETWEEN 1 AND 999),
  qr_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_table_cards_group_number_unique UNIQUE (group_id, card_number),
  CONSTRAINT event_table_cards_identifier_pair CHECK (
    (physical_identifier_type IS NULL AND physical_identifier_number IS NULL)
    OR (physical_identifier_type IS NOT NULL AND physical_identifier_number IS NOT NULL
        AND physical_identifier_type = card_type)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS event_table_cards_physical_identifier_unique
  ON public.event_table_cards(event_id, physical_identifier_type, physical_identifier_number)
  WHERE physical_identifier_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_table_cards_event_idx
  ON public.event_table_cards(event_id, card_type, card_number);

ALTER TABLE public.event_table_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event managers manage table cards" ON public.event_table_cards;
CREATE POLICY "event managers manage table cards"
  ON public.event_table_cards FOR ALL TO authenticated
  USING (public.can_manage_event(auth.uid(), event_id))
  WITH CHECK (public.can_manage_event(auth.uid(), event_id));

CREATE OR REPLACE FUNCTION public.validate_event_table_card()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE g public.ticket_groups;
BEGIN
  SELECT * INTO g FROM public.ticket_groups WHERE id = NEW.group_id AND event_id = NEW.event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O grupo selecionado não pertence a este evento'; END IF;

  IF COALESCE(g.price, 0) = 1000000 AND NEW.card_type <> 'BOX' THEN
    RAISE EXCEPTION 'Grupos de 1.000.000 Kz exigem cartão do tipo BOX';
  END IF;
  IF COALESCE(g.price, 0) <> 1000000 AND NEW.card_type = 'BOX' THEN
    RAISE EXCEPTION 'Cartões BOX são reservados à categoria de 1.000.000 Kz';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_event_table_card_trigger ON public.event_table_cards;
CREATE TRIGGER validate_event_table_card_trigger
  BEFORE INSERT OR UPDATE ON public.event_table_cards
  FOR EACH ROW EXECUTE FUNCTION public.validate_event_table_card();

CREATE OR REPLACE FUNCTION public.verify_table_card(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.event_table_cards; e public.events; g public.ticket_groups;
BEGIN
  IF p_token IS NULL THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO c FROM public.event_table_cards WHERE qr_token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO e FROM public.events WHERE id = c.event_id;
  SELECT * INTO g FROM public.ticket_groups WHERE id = c.group_id;

  RETURN jsonb_build_object(
    'result', c.status,
    'event', e.name,
    'card_type', c.card_type,
    'card_number', c.card_number,
    'category', g.name,
    'price', g.price,
    'holder_name', c.holder_name,
    'capacity', c.capacity,
    'physical_identifier_type', c.physical_identifier_type,
    'physical_identifier_number', c.physical_identifier_number
  );
END $$;

REVOKE ALL ON FUNCTION public.verify_table_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_table_card(uuid) TO anon, authenticated;
