-- Add per-table guest capacity and a read-only public verifier for table cards.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS table_capacity integer;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_table_capacity_positive
  CHECK (table_capacity IS NULL OR table_capacity BETWEEN 1 AND 1000);

CREATE OR REPLACE FUNCTION public.verify_table_card(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tickets;
  g public.ticket_groups;
  e public.events;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) < 6 OR length(trim(p_code)) > 80 THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT * INTO t
  FROM public.tickets
  WHERE code = upper(trim(p_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT * INTO g FROM public.ticket_groups WHERE id = t.group_id;
  IF g.id IS NULL OR upper(g.ticket_type) NOT LIKE '%MESA%' THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT * INTO e FROM public.events WHERE id = t.event_id;

  RETURN jsonb_build_object(
    'result', CASE WHEN t.status = 'valid' THEN 'valid' ELSE t.status END,
    'event', e.name,
    'table_number', t.seq,
    'holder_name', t.holder_name,
    'capacity', t.table_capacity,
    'group', g.name,
    'code', t.code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_table_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_table_card(text) TO anon, authenticated;
