INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-flyers',
  'event-flyers',
  true,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "event managers read flyers" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'event-flyers'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

CREATE POLICY "event managers upload flyers" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-flyers'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

CREATE POLICY "event managers delete flyers" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-flyers'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

CREATE POLICY "event managers insert arts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'arts'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

CREATE POLICY "event managers update arts" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'arts'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

CREATE POLICY "event managers delete arts" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'arts'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );
