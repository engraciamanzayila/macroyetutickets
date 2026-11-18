-- Independent credentialing data. Credentials are never ticket rows.
CREATE TABLE IF NOT EXISTS public.credential_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  event_name text NOT NULL,
  group_name text NOT NULL,
  credential_type text NOT NULL,
  size_code text NOT NULL DEFAULT 'A6' CHECK (size_code IN ('A6','A5','A4','CUSTOM')),
  width_mm numeric(8,2) NOT NULL DEFAULT 105 CHECK (width_mm > 0),
  height_mm numeric(8,2) NOT NULL DEFAULT 148 CHECK (height_mm > 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  art_path text NOT NULL,
  art_width integer NOT NULL,
  art_height integer NOT NULL,
  qr_layout jsonb NOT NULL DEFAULT '{"x":0.82,"y":0.78,"size":0.18}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credential_batches_event_idx ON public.credential_batches(event_id, created_at);

CREATE TABLE IF NOT EXISTS public.credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.credential_batches(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  seq integer NOT NULL CHECK (seq > 0),
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','used','void')),
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, seq)
);
CREATE INDEX IF NOT EXISTS credentials_event_code_idx ON public.credentials(event_id, code);
CREATE INDEX IF NOT EXISTS credentials_batch_seq_idx ON public.credentials(batch_id, seq);

ALTER TABLE public.credential_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view credential batches" ON public.credential_batches
  FOR SELECT TO authenticated USING (public.can_view_event(auth.uid(), event_id));
CREATE POLICY "manage credential batches" ON public.credential_batches
  FOR ALL TO authenticated USING (public.can_manage_event(auth.uid(), event_id))
  WITH CHECK (public.can_manage_event(auth.uid(), event_id));
CREATE POLICY "view credentials" ON public.credentials
  FOR SELECT TO authenticated USING (public.can_view_event(auth.uid(), event_id));
CREATE POLICY "manage credentials" ON public.credentials
  FOR ALL TO authenticated USING (public.can_manage_event(auth.uid(), event_id))
  WITH CHECK (public.can_manage_event(auth.uid(), event_id));

CREATE OR REPLACE FUNCTION public.check_in_credential(p_event uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE item public.credentials%ROWTYPE;
DECLARE batch public.credential_batches%ROWTYPE;
BEGIN
  IF NOT public.can_view_event(auth.uid(), p_event) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Credential scans are read-only: unlike tickets, a credential can be
  -- checked repeatedly because its holder may enter and leave many times.
  SELECT * INTO item FROM public.credentials
  WHERE event_id = p_event AND upper(code) = upper(trim(p_code));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','not_found','code',upper(trim(p_code)));
  END IF;

  SELECT * INTO batch FROM public.credential_batches WHERE id = item.batch_id;

  IF item.status = 'void' THEN
    RETURN jsonb_build_object('result','void','code',item.code,'group',batch.group_name,'type',batch.credential_type);
  END IF;

  RETURN jsonb_build_object('result','ok','code',item.code,'group',batch.group_name,'type',batch.credential_type);
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_in_credential(uuid,text) TO authenticated;
