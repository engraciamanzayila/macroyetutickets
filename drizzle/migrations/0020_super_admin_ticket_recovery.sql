DROP POLICY IF EXISTS "event managers read print files" ON storage.objects;
CREATE POLICY "super admin read print files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'print-files' AND public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_ticket_distribution_reset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_super_admin(auth.uid())
     AND (
       (OLD.printed_at IS NOT NULL AND NEW.printed_at IS NULL)
       OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS NULL)
       OR (
         OLD.share_id IS NOT NULL
         AND NEW.share_id IS NULL
         AND (OLD.printed_at IS NOT NULL OR OLD.sent_at IS NOT NULL)
       )
       OR (OLD.email_delivery_status = 'sent' AND NEW.email_delivery_status <> 'sent')
     )
  THEN
    RAISE EXCEPTION 'Apenas o superadministrador pode libertar ingressos já enviados ou impressos';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_ticket_distribution_reset ON public.tickets;
CREATE TRIGGER guard_ticket_distribution_reset
BEFORE UPDATE OF printed_at, sent_at, sent_via, share_id, email_delivery_status
ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.guard_ticket_distribution_reset();

CREATE OR REPLACE FUNCTION public.release_tickets_for_redistribution(
  p_event uuid,
  p_ticket_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_count integer := cardinality(p_ticket_ids);
  eligible_count integer;
  updated_count integer;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o superadministrador pode libertar ingressos já enviados ou impressos';
  END IF;
  IF requested_count IS NULL OR requested_count < 1 OR requested_count > 500 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 500 ingressos';
  END IF;

  PERFORM id
  FROM public.tickets
  WHERE event_id = p_event AND id = ANY(p_ticket_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT count(*) INTO eligible_count
  FROM public.tickets
  WHERE event_id = p_event
    AND id = ANY(p_ticket_ids)
    AND status = 'valid'
    AND (
      printed_at IS NOT NULL
      OR sent_at IS NOT NULL
      OR email_delivery_status = 'sent'
    );

  IF eligible_count <> requested_count THEN
    RAISE EXCEPTION 'Um ou mais ingressos não estão válidos, enviados ou impressos neste evento';
  END IF;

  UPDATE public.tickets
  SET printed_at = NULL,
      sent_at = NULL,
      sent_via = NULL,
      share_id = NULL,
      email_delivery_status = 'pending',
      email_delivery_cc = '{}',
      email_delivery_error = NULL,
      email_delivery_updated_at = NULL,
      email_sent_at = NULL
  WHERE event_id = p_event AND id = ANY(p_ticket_ids);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_tickets_for_redistribution(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_tickets_for_redistribution(uuid, uuid[]) TO authenticated;
