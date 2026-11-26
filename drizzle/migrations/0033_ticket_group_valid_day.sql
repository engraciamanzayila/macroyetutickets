-- Optional per-ticket-group event date. NULL preserves existing single-day ticket behavior.
ALTER TABLE public.ticket_groups
  ADD COLUMN IF NOT EXISTS valid_on date;

CREATE INDEX IF NOT EXISTS ticket_groups_event_valid_on_idx
  ON public.ticket_groups(event_id, valid_on);

-- Keep the established authorization and QR validation flow. Only date-scoped groups
-- gain an additional check; groups with valid_on NULL behave exactly as before.
CREATE OR REPLACE FUNCTION public.check_in(
  p_event uuid,
  p_code text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tickets;
  g public.ticket_groups;
  scan_date date;
BEGIN
  IF NOT public.can_view_event(auth.uid(), p_event) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO t
  FROM public.tickets
  WHERE event_id = p_event AND code = upper(trim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT * INTO g FROM public.ticket_groups WHERE id = t.group_id;

  IF t.status = 'void' THEN
    RETURN jsonb_build_object('result','void','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient);
  ELSIF t.status = 'used' THEN
    RETURN jsonb_build_object('result','used','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient,'used_at',t.used_at);
  END IF;

  scan_date := (COALESCE(p_at, now()) AT TIME ZONE 'Africa/Luanda')::date;
  IF g.valid_on IS NOT NULL AND scan_date <> g.valid_on THEN
    RETURN jsonb_build_object(
      'result', 'wrong_day',
      'code', t.code,
      'group', g.name,
      'type', g.ticket_type,
      'recipient', g.recipient,
      'valid_on', g.valid_on,
      'scanned_on', scan_date
    );
  END IF;

  UPDATE public.tickets
  SET status = 'used', used_at = COALESCE(p_at, now()), used_by = auth.uid()
  WHERE id = t.id;

  RETURN jsonb_build_object('result','ok','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient);
END;
$$;

REVOKE ALL ON FUNCTION public.check_in(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(uuid, text, timestamptz) TO authenticated;
