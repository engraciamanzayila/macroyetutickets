INSERT INTO storage.buckets (id, name, public)
VALUES ('print-files', 'print-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_by uuid,
  file_name text NOT NULL,
  storage_path text,
  source_printed_at timestamptz NOT NULL,
  ticket_ids uuid[] NOT NULL DEFAULT '{}',
  ticket_count integer NOT NULL DEFAULT 0,
  page_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX print_jobs_event_created_idx ON public.print_jobs(event_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.print_jobs TO authenticated;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event managers manage print jobs" ON public.print_jobs FOR ALL TO authenticated
  USING (public.can_manage_event(auth.uid(), event_id))
  WITH CHECK (public.can_manage_event(auth.uid(), event_id));

CREATE POLICY "event managers read print files" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'print-files'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

CREATE POLICY "event managers write print files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'print-files'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

CREATE POLICY "event managers delete print files" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'print-files'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );