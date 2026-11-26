-- Free-transit validation follows the same operational access model as ticket validation.
-- Admin, event-owning promoters and gate staff may validate; support roles may not.
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(normalized_plate) < 5 OR length(normalized_plate) > 10 THEN
    RAISE EXCEPTION 'invalid_vehicle_plate';
  END IF;

  SELECT * INTO pass
  FROM public.event_free_transit_passes
  WHERE qr_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','not_found');
  END IF;
  IF NOT public.can_view_event(auth.uid(), pass.event_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
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

REVOKE ALL ON FUNCTION public.check_in_free_transit(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_free_transit(uuid,text) TO authenticated;
