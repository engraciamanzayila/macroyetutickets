CREATE TABLE public.group_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.ticket_groups(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  partner_name text NOT NULL,
  partner_kind text NOT NULL DEFAULT 'Parceiro',
  contact text,
  note text,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_shares TO authenticated;
GRANT ALL ON public.group_shares TO service_role;
ALTER TABLE public.group_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage shares" ON public.group_shares FOR ALL TO authenticated
  USING (public.can_manage_event(auth.uid(), event_id)) WITH CHECK (public.can_manage_event(auth.uid(), event_id));

ALTER TABLE public.tickets
  ADD COLUMN share_id uuid REFERENCES public.group_shares(id) ON DELETE SET NULL,
  ADD COLUMN share_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN holder_name text,
  ADD COLUMN holder_contact text,
  ADD COLUMN sent_via text,
  ADD COLUMN sent_at timestamptz;
CREATE UNIQUE INDEX tickets_share_token_idx ON public.tickets(share_token);
CREATE INDEX tickets_share_id_idx ON public.tickets(share_id);
CREATE INDEX tickets_printed_at_idx ON public.tickets(event_id, printed_at);