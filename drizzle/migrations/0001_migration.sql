CREATE POLICY "members read arts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'arts' AND public.is_member(auth.uid()));
CREATE POLICY "admin insert arts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'arts' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin update arts" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'arts' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete arts" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'arts' AND public.has_role(auth.uid(),'admin'));