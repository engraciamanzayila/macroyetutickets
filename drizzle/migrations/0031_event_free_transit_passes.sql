-- THIS IS HOUSE MUSIC: individual, vehicle-bound free-transit passes.
CREATE TABLE IF NOT EXISTS public.event_free_transit_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  reference_code text NOT NULL UNIQUE,
  qr_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','void')),
  vehicle_plate text,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_free_transit_plate_format CHECK (vehicle_plate IS NULL OR vehicle_plate ~ '^[A-Z0-9-]{5,10}$')
);
CREATE INDEX IF NOT EXISTS event_free_transit_event_idx ON public.event_free_transit_passes(event_id);
CREATE INDEX IF NOT EXISTS event_free_transit_status_idx ON public.event_free_transit_passes(event_id,status);
ALTER TABLE public.event_free_transit_passes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.event_free_transit_passes TO authenticated;
GRANT ALL ON public.event_free_transit_passes TO service_role;
DROP POLICY IF EXISTS "event managers manage free transit passes" ON public.event_free_transit_passes;
DROP POLICY IF EXISTS "staff read free transit passes" ON public.event_free_transit_passes;
CREATE POLICY "staff read free transit passes"
  ON public.event_free_transit_passes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'staff'));
CREATE POLICY "event managers manage free transit passes"
  ON public.event_free_transit_passes FOR ALL TO authenticated
  USING (public.can_manage_event(auth.uid(), event_id))
  WITH CHECK (public.can_manage_event(auth.uid(), event_id));

CREATE OR REPLACE FUNCTION public.check_in_free_transit(p_token uuid, p_plate text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pass public.event_free_transit_passes;
  normalized_plate text := upper(regexp_replace(trim(COALESCE(p_plate,'')), '[^A-Z0-9]', '', 'g'));
BEGIN
  IF NOT public.is_member(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(normalized_plate) < 5 OR length(normalized_plate) > 10 THEN
    RAISE EXCEPTION 'invalid_vehicle_plate';
  END IF;
  SELECT * INTO pass
  FROM public.event_free_transit_passes
  WHERE qr_token = p_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','not_found'); END IF;
  IF pass.status = 'void' THEN
    RETURN jsonb_build_object('result','void');
  END IF;
  IF pass.status = 'used' THEN
    IF pass.vehicle_plate = normalized_plate THEN
      RETURN jsonb_build_object('result','same_vehicle','vehicle_plate',pass.vehicle_plate);
    END IF;
    RETURN jsonb_build_object('result','different_vehicle','vehicle_plate',pass.vehicle_plate);
  END IF;
  UPDATE public.event_free_transit_passes
  SET status='used', vehicle_plate=normalized_plate, checked_in_at=now(), checked_in_by=auth.uid()
  WHERE id=pass.id;
  RETURN jsonb_build_object('result','ok','vehicle_plate',normalized_plate,'reference_code',pass.reference_code);
END;
$$;
REVOKE ALL ON FUNCTION public.check_in_free_transit(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_free_transit(uuid,text) TO authenticated;
