-- Restrict event check-in and event data visibility to operational roles.
-- Promoters retain access only to events they own through can_manage_event.
-- Portaria can validate all events. Support roles can assist with orders/profiles
-- through their dedicated RLS policies, but cannot scan tickets or credentials.

CREATE OR REPLACE FUNCTION public.can_view_event(_uid uuid, _event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid = auth.uid()
     AND (
       public.has_role(auth.uid(),'staff')
       OR public.can_manage_event(auth.uid(),_event)
     )
$$;

REVOKE ALL ON FUNCTION public.can_view_event(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_event(uuid,uuid) TO authenticated;
