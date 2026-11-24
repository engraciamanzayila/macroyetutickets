-- Remove only the MY Tickets test event explicitly approved for cleanup.
-- Cascading foreign keys remove records owned by this event only.
DO $$
DECLARE
  target_id uuid := 'fd2a4ce6-499a-4974-bc09-8bbfab1e749b';
  target_name text;
BEGIN
  SELECT name INTO target_name FROM public.events WHERE id=target_id FOR UPDATE;
  IF target_name IS NULL THEN
    RAISE NOTICE 'Target event already absent; no rows deleted.';
  ELSIF target_name <> 'THIS IS HOUSE MUSIC' THEN
    RAISE EXCEPTION 'Event identity mismatch; refusing deletion.';
  ELSE
    DELETE FROM public.events WHERE id=target_id;
  END IF;
END $$;
