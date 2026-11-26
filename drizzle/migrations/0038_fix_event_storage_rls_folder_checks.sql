-- Repair event-scoped Storage RLS policies.
-- The previous predicates inspected events.name instead of the uploaded object's path,
-- so valid event folders were rejected by Storage.
DROP POLICY IF EXISTS "event managers read flyers" ON storage.objects;
CREATE POLICY "event managers read flyers" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'event-flyers'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

DROP POLICY IF EXISTS "event managers upload flyers" ON storage.objects;
CREATE POLICY "event managers upload flyers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-flyers'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

DROP POLICY IF EXISTS "event managers delete flyers" ON storage.objects;
CREATE POLICY "event managers delete flyers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-flyers'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

DROP POLICY IF EXISTS "event managers insert arts" ON storage.objects;
CREATE POLICY "event managers insert arts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'arts'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

DROP POLICY IF EXISTS "event managers update arts" ON storage.objects;
CREATE POLICY "event managers update arts" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'arts'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  )
  WITH CHECK (
    bucket_id = 'arts'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

DROP POLICY IF EXISTS "event managers delete arts" ON storage.objects;
CREATE POLICY "event managers delete arts" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'arts'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

DROP POLICY IF EXISTS "event managers delete print files" ON storage.objects;
CREATE POLICY "event managers delete print files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'print-files'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );

DROP POLICY IF EXISTS "event managers write print files" ON storage.objects;
CREATE POLICY "event managers write print files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'print-files'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE (storage.foldername(storage.objects.name))[1] = e.id::text
        AND public.can_manage_event(auth.uid(), e.id)
    )
  );
