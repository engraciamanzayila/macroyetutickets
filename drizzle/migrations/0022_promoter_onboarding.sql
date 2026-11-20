-- Promoter onboarding: separate customer accounts from legal promoter applications.
CREATE TABLE IF NOT EXISTS public.promoter_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','under_review','changes_requested','approved','rejected')),
  application_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  promoter_signed_name text,
  promoter_signed_at timestamptz,
  admin_signed_name text,
  admin_signed_by uuid,
  admin_signed_at timestamptz,
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promoter_applications_user_idx ON public.promoter_applications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promoter_applications_status_idx ON public.promoter_applications(status, created_at);
ALTER TABLE public.promoter_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.promoter_applications TO authenticated;
GRANT ALL ON public.promoter_applications TO service_role;
CREATE POLICY "promoter applications own or admin read" ON public.promoter_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "promoter applications own insert" ON public.promoter_applications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');
CREATE POLICY "promoter applications admin update" ON public.promoter_applications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Private bucket for identity/legal files.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('promoter-documents','promoter-documents',false,10485760,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=10485760,
  allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png'];
CREATE POLICY "promoter docs owner upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='promoter-documents' AND split_part(name,'/',1)=auth.uid()::text);
CREATE POLICY "promoter docs owner or admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='promoter-documents' AND (split_part(name,'/',1)=auth.uid()::text OR public.has_role(auth.uid(),'admin')));
CREATE POLICY "promoter docs owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='promoter-documents' AND split_part(name,'/',1)=auth.uid()::text);

CREATE OR REPLACE FUNCTION public.submit_promoter_application(p_data jsonb, p_documents jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE app_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicie sessão para enviar a candidatura'; END IF;
  IF length(trim(coalesce(p_data->>'full_name',''))) < 3
    OR length(trim(coalesce(p_data->>'phone',''))) < 6
    OR length(trim(coalesce(p_data->>'address',''))) < 5
    OR length(trim(coalesce(p_data->>'bi_number',''))) < 5
    OR length(trim(coalesce(p_data->>'nif',''))) < 5
    OR length(trim(coalesce(p_data->>'promoter_type',''))) = 0
    OR length(trim(coalesce(p_data->>'iban',''))) < 8 THEN
    RAISE EXCEPTION 'Preencha todos os dados obrigatórios da candidatura';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promoter_applications WHERE user_id=auth.uid() AND status IN ('pending','under_review','changes_requested')) THEN
    RAISE EXCEPTION 'Já existe uma candidatura em análise. Consulte a equipa MY Tickets.';
  END IF;
  INSERT INTO public.promoter_applications(user_id, application_data, document_paths)
  VALUES(auth.uid(), coalesce(p_data,'{}'::jsonb), coalesce(p_documents,'[]'::jsonb))
  RETURNING id INTO app_id;
  UPDATE public.profiles SET full_name=coalesce(nullif(trim(p_data->>'full_name'),''),full_name),
    phone=coalesce(nullif(trim(p_data->>'phone'),''),phone),
    company=nullif(trim(p_data->>'company_name'),'')
  WHERE id=auth.uid();
  RETURN app_id;
END $$;
GRANT EXECUTE ON FUNCTION public.submit_promoter_application(jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sign_promoter_application(p_application uuid, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR length(trim(coalesce(p_name,''))) < 3 THEN
    RAISE EXCEPTION 'Inicie sessão e escreva o nome completo para assinar';
  END IF;
  UPDATE public.promoter_applications SET promoter_signed_name=trim(p_name), promoter_signed_at=now(),
    status=CASE WHEN status='changes_requested' THEN 'pending' ELSE status END, updated_at=now()
  WHERE id=p_application AND user_id=auth.uid() AND status IN ('pending','changes_requested');
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidatura não encontrada ou indisponível para assinatura'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.sign_promoter_application(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_promoter_application(p_application uuid, p_decision text, p_note text DEFAULT NULL, p_admin_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE app public.promoter_applications;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Apenas a administração pode analisar candidaturas'; END IF;
  IF p_decision NOT IN ('under_review','changes_requested','rejected','approved') THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
  SELECT * INTO app FROM public.promoter_applications WHERE id=p_application FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidatura não encontrada'; END IF;
  IF p_decision='approved' AND app.promoter_signed_at IS NULL THEN RAISE EXCEPTION 'O promotor ainda não assinou o contrato'; END IF;
  UPDATE public.promoter_applications SET status=p_decision, admin_note=nullif(trim(coalesce(p_note,'')),''),
    admin_signed_name=CASE WHEN p_decision='approved' THEN coalesce(nullif(trim(p_admin_name),''),'MY Tickets') ELSE admin_signed_name END,
    admin_signed_by=CASE WHEN p_decision='approved' THEN auth.uid() ELSE admin_signed_by END,
    admin_signed_at=CASE WHEN p_decision='approved' THEN now() ELSE admin_signed_at END,
    reviewed_at=now(), updated_at=now() WHERE id=p_application;
  IF p_decision='approved' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES(app.user_id,'promoter') ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.profiles SET wants_promoter=false WHERE id=app.user_id;
  ELSIF p_decision IN ('rejected','changes_requested') THEN
    DELETE FROM public.user_roles WHERE user_id=app.user_id AND role='promoter';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.review_promoter_application(uuid,text,text,text) TO authenticated;

-- Enforce the agreed rates in database defaults and contract signing.
ALTER TABLE public.events ALTER COLUMN commission_pct SET DEFAULT 5;
ALTER TABLE public.event_contracts ALTER COLUMN commission_pct SET DEFAULT 5;
CREATE OR REPLACE FUNCTION public.events_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('app.bypass', true)='1' OR public.has_role(auth.uid(),'admin') OR auth.uid() IS NULL THEN
    IF NEW.approval_status IN ('approved','rejected') AND (TG_OP='INSERT' OR OLD.approval_status IS DISTINCT FROM NEW.approval_status) THEN
      NEW.approved_by:=auth.uid(); NEW.approved_at:=now(); END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' THEN NEW.commission_pct:=5; NEW.approval_status:='draft'; NEW.published:=false; RETURN NEW; END IF;
  NEW.commission_pct:=OLD.commission_pct;
  IF NEW.approval_status<>OLD.approval_status AND NEW.approval_status NOT IN ('draft','submitted') THEN NEW.approval_status:=OLD.approval_status; END IF;
  IF NEW.published AND NEW.approval_status<>'approved' THEN RAISE EXCEPTION 'O evento precisa de aprovação da administração antes de ser publicado'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.sign_contract(p_event uuid,p_exclusive boolean,p_data jsonb,p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pct numeric:=CASE WHEN p_exclusive THEN 3.5 ELSE 5 END;
BEGIN
  IF NOT public.can_manage_event(auth.uid(),p_event) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(trim(coalesce(p_name,'')))<3 THEN RAISE EXCEPTION 'Escreva o nome completo para assinar'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_contracts WHERE event_id=p_event AND admin_signed_at IS NOT NULL) THEN RAISE EXCEPTION 'Contrato já aprovado — não pode ser alterado'; END IF;
  INSERT INTO public.event_contracts(event_id,promoter_id,exclusive,commission_pct,data,signed_name)
  VALUES(p_event,auth.uid(),p_exclusive,pct,coalesce(p_data,'{}'),trim(p_name))
  ON CONFLICT(event_id) DO UPDATE SET exclusive=EXCLUDED.exclusive,commission_pct=EXCLUDED.commission_pct,data=EXCLUDED.data,signed_name=EXCLUDED.signed_name,signed_at=now(),promoter_id=EXCLUDED.promoter_id;
  PERFORM set_config('app.bypass','1',true);
  UPDATE public.events SET commission_pct=pct,approval_status=CASE WHEN approval_status='approved' THEN approval_status ELSE 'submitted' END WHERE id=p_event;
  PERFORM set_config('app.bypass','0',true);
END $$;
