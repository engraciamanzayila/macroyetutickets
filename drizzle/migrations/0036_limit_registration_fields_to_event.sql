-- Do not retain an institution field for events that have not enabled it.
CREATE OR REPLACE FUNCTION public.limit_order_registration_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  institution_enabled boolean;
BEGIN
  SELECT COALESCE((registration_fields->>'institution')::boolean, false)
    INTO institution_enabled
  FROM public.events
  WHERE id = NEW.event_id;

  IF NOT COALESCE(institution_enabled, false) THEN
    NEW.buyer_institution := NULL;
  ELSE
    NEW.buyer_institution := NULLIF(LEFT(TRIM(COALESCE(NEW.buyer_institution, '')), 180), '');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_limit_registration_fields ON public.orders;
CREATE TRIGGER orders_limit_registration_fields
BEFORE INSERT OR UPDATE OF event_id, buyer_institution ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.limit_order_registration_fields();
