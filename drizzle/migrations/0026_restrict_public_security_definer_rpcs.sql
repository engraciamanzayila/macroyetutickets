-- Limit security-definer RPCs that expose or mutate privileged event and role data.
-- Public checkout and token-based order lookup functions remain available to anon.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_member(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event(_uid uuid, _event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid = auth.uid()
     AND (
       public.has_role(auth.uid(),'admin')
       OR EXISTS (
         SELECT 1 FROM public.events e
         WHERE e.id = _event AND e.owner_id = auth.uid()
           AND public.has_role(auth.uid(),'promoter')
       )
     )
$$;

CREATE OR REPLACE FUNCTION public.can_view_event(_uid uuid, _event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid = auth.uid()
     AND (
       public.has_role(auth.uid(),'staff')
       OR public.has_role(auth.uid(),'consumer_support')
       OR public.has_role(auth.uid(),'promoter_support')
       OR public.can_manage_event(auth.uid(),_event)
     )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT _uid = auth.uid() AND EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.user_roles r ON r.user_id = u.id
    WHERE u.id = auth.uid()
      AND lower(coalesce(u.email, '')) = 'macroyetu@gmail.com'
      AND u.email_confirmed_at IS NOT NULL
      AND r.role = 'admin'::public.app_role
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_event(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_event(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_view_event(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_event(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.check_in_credential(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_credential(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_ticket_email_delivery(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ticket_email_delivery(uuid,uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_order(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.is_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.review_event(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_event(uuid,boolean,text) TO authenticated;
REVOKE ALL ON FUNCTION public.sign_contract(uuid,boolean,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_contract(uuid,boolean,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_orders() TO service_role;
