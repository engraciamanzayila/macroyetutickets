ALTER TABLE public.events ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approval_note text, ADD COLUMN IF NOT EXISTS approved_by uuid, ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=_uid AND lower(email)='macroyetu@gmail.com') AND public.has_role(_uid,'admin') $$;

CREATE OR REPLACE FUNCTION public.events_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('app.bypass', true) = '1' OR public.has_role(auth.uid(),'admin') OR auth.uid() IS NULL THEN
    IF NEW.approval_status IN ('approved','rejected') AND (TG_OP='INSERT' OR OLD.approval_status IS DISTINCT FROM NEW.approval_status) THEN
      NEW.approved_by := auth.uid(); NEW.approved_at := now(); END IF;
    RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN NEW.commission_pct := 10; NEW.approval_status := 'draft'; NEW.published := false; RETURN NEW; END IF;
  NEW.commission_pct := OLD.commission_pct;
  IF NEW.approval_status <> OLD.approval_status AND NEW.approval_status NOT IN ('draft','submitted') THEN NEW.approval_status := OLD.approval_status; END IF;
  IF NEW.published AND NEW.approval_status <> 'approved' THEN RAISE EXCEPTION 'O evento precisa de aprovação da administração antes de ser publicado'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_guard BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_guard();

CREATE OR REPLACE FUNCTION public.groups_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.quantity <> OLD.quantity AND EXISTS (SELECT 1 FROM public.tickets WHERE group_id=OLD.id) AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Só a administração pode gerar ingressos extra em grupos já gerados'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER groups_guard BEFORE UPDATE ON public.ticket_groups FOR EACH ROW EXECUTE FUNCTION public.groups_guard();

DROP POLICY IF EXISTS "public read published events" ON public.events;
CREATE POLICY "public read published events" ON public.events FOR SELECT TO anon USING (published AND approval_status='approved');
DROP POLICY IF EXISTS "public read groups" ON public.ticket_groups;
CREATE POLICY "public read groups" ON public.ticket_groups FOR SELECT TO anon USING (for_sale AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=ticket_groups.event_id AND e.published AND e.approval_status='approved'));

DROP POLICY IF EXISTS "admin insert roles" ON public.user_roles;
CREATE POLICY "admin insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') AND (role <> 'admin' OR public.is_super_admin(auth.uid())));
DROP POLICY IF EXISTS "admin delete roles" ON public.user_roles;
CREATE POLICY "admin delete roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') AND user_id <> auth.uid() AND NOT public.is_super_admin(user_id) AND (role <> 'admin' OR public.is_super_admin(auth.uid())));

CREATE TABLE public.event_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  promoter_id uuid NOT NULL,
  exclusive boolean NOT NULL DEFAULT false,
  commission_pct numeric NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_name text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  admin_signed_by uuid, admin_signed_name text, admin_signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_contracts TO authenticated;
GRANT ALL ON public.event_contracts TO service_role;
ALTER TABLE public.event_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view contracts" ON public.event_contracts FOR SELECT TO authenticated USING (public.can_manage_event(auth.uid(), event_id));

CREATE OR REPLACE FUNCTION public.sign_contract(p_event uuid, p_exclusive boolean, p_data jsonb, p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pct numeric := CASE WHEN p_exclusive THEN 8 ELSE 10 END;
BEGIN
  IF NOT public.can_manage_event(auth.uid(), p_event) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(trim(coalesce(p_name,''))) < 3 THEN RAISE EXCEPTION 'Escreva o nome completo para assinar'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_contracts WHERE event_id=p_event AND admin_signed_at IS NOT NULL) THEN RAISE EXCEPTION 'Contrato já aprovado — não pode ser alterado'; END IF;
  INSERT INTO public.event_contracts(event_id, promoter_id, exclusive, commission_pct, data, signed_name)
  VALUES (p_event, auth.uid(), p_exclusive, pct, coalesce(p_data,'{}'), trim(p_name))
  ON CONFLICT (event_id) DO UPDATE SET exclusive=EXCLUDED.exclusive, commission_pct=EXCLUDED.commission_pct, data=EXCLUDED.data, signed_name=EXCLUDED.signed_name, signed_at=now(), promoter_id=EXCLUDED.promoter_id;
  PERFORM set_config('app.bypass','1',true);
  UPDATE public.events SET commission_pct=pct, approval_status=CASE WHEN approval_status='approved' THEN approval_status ELSE 'submitted' END WHERE id=p_event;
  PERFORM set_config('app.bypass','0',true);
END $$;

CREATE OR REPLACE FUNCTION public.review_event(p_event uuid, p_approve boolean, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE nm text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT coalesce(full_name,email) INTO nm FROM public.profiles WHERE id=auth.uid();
  UPDATE public.events SET approval_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, approval_note=nullif(trim(coalesce(p_note,'')),''),
    published = CASE WHEN p_approve THEN published ELSE false END WHERE id=p_event;
  IF p_approve THEN
    UPDATE public.event_contracts SET admin_signed_by=auth.uid(), admin_signed_name=nm, admin_signed_at=now() WHERE event_id=p_event;
  END IF;
END $$;