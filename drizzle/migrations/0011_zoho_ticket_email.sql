ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS ticket_email_cc text,
  ADD COLUMN IF NOT EXISTS ticket_email_extra_cc text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS email_delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_delivery_to text,
  ADD COLUMN IF NOT EXISTS email_delivery_cc text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_delivery_error text,
  ADD COLUMN IF NOT EXISTS email_delivery_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_email_delivery_status_check
  CHECK (email_delivery_status IN ('pending', 'sending', 'sent', 'failed'));

CREATE INDEX tickets_email_delivery_idx ON public.tickets(event_id, email_delivery_status);

CREATE TABLE public.zoho_mail_config (
  id integer PRIMARY KEY CHECK (id = 1),
  ciphertext text NOT NULL,
  sender_email text NOT NULL CHECK (lower(sender_email) = 'mytickets@macroyetu.com'),
  data_center text NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zoho_mail_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zoho_mail_config TO service_role;

CREATE OR REPLACE FUNCTION public.claim_ticket_email_delivery(p_event uuid, p_ticket_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE requested_count integer := cardinality(p_ticket_ids);
DECLARE eligible_count integer;
DECLARE updated_count integer;
BEGIN
  IF NOT public.can_manage_event(auth.uid(), p_event) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF requested_count IS NULL OR requested_count < 1 OR requested_count > 500 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 500 ingressos';
  END IF;

  PERFORM id FROM public.tickets
  WHERE event_id = p_event AND id = ANY(p_ticket_ids)
  ORDER BY id FOR UPDATE;

  SELECT count(*) INTO eligible_count FROM public.tickets
  WHERE event_id = p_event AND id = ANY(p_ticket_ids)
    AND status = 'valid' AND printed_at IS NULL AND share_id IS NULL AND sent_at IS NULL
    AND (
      email_delivery_status IN ('pending', 'failed')
      OR (email_delivery_status = 'sending' AND email_delivery_updated_at < now() - interval '5 minutes')
    );
  IF eligible_count <> requested_count THEN RETURN false; END IF;

  UPDATE public.tickets
  SET email_delivery_status = 'sending', email_delivery_error = NULL, email_delivery_updated_at = now()
  WHERE event_id = p_event AND id = ANY(p_ticket_ids)
    AND status = 'valid' AND printed_at IS NULL AND share_id IS NULL AND sent_at IS NULL
    AND (
      email_delivery_status IN ('pending', 'failed')
      OR (email_delivery_status = 'sending' AND email_delivery_updated_at < now() - interval '5 minutes')
    );
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = requested_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_ticket_email_delivery(uuid, uuid[]) TO authenticated;