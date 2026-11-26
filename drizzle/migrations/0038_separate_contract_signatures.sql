-- MY Tickets: strictly separate the promoter's signature from the platform administrator's countersignature.
CREATE OR REPLACE FUNCTION public.sign_contract(p_event uuid,p_exclusive boolean,p_data jsonb,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pct numeric:=CASE WHEN p_exclusive THEN 3.5 ELSE 5 END; assigned_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicie sessão para assinar o contrato.'; END IF;
  SELECT owner_id INTO assigned_owner FROM public.events WHERE id=p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento não encontrado.'; END IF;
  IF assigned_owner IS DISTINCT FROM auth.uid()
     OR NOT public.has_role(auth.uid(),'promoter')
     OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')
     OR public.has_role(auth.uid(),'consumer_support') OR public.has_role(auth.uid(),'promoter_support') THEN
    RAISE EXCEPTION 'Apenas o Promotor associado ao evento pode assinar como segundo outorgante.';
  END IF;
  IF length(trim(coalesce(p_name,'')))<3 THEN RAISE EXCEPTION 'Escreva o nome completo para assinar.'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_contracts WHERE event_id=p_event AND admin_signed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'O contrato já foi assinado pela Administração e não pode ser alterado.';
  END IF;
  INSERT INTO public.event_contracts(event_id,promoter_id,exclusive,commission_pct,data,signed_name,signed_at)
  VALUES(p_event,auth.uid(),p_exclusive,pct,coalesce(p_data,'{}'::jsonb),trim(p_name),now())
  ON CONFLICT(event_id) DO UPDATE SET exclusive=EXCLUDED.exclusive,commission_pct=EXCLUDED.commission_pct,
    data=EXCLUDED.data,signed_name=EXCLUDED.signed_name,signed_at=now(),promoter_id=EXCLUDED.promoter_id
  WHERE public.event_contracts.promoter_id=auth.uid() AND public.event_contracts.admin_signed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'A assinatura existente pertence a outro interveniente ou o contrato já foi finalizado.'; END IF;
  PERFORM set_config('app.bypass','1',true);
  UPDATE public.events SET commission_pct=pct,approval_status=CASE WHEN approval_status='approved' THEN approval_status ELSE 'submitted' END WHERE id=p_event;
  PERFORM set_config('app.bypass','0',true);
END $$;

CREATE OR REPLACE FUNCTION public.review_event(p_event uuid,p_approve boolean,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE nm text; assigned_promoter uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Apenas a Administração pode rever e assinar pela plataforma.';
  END IF;
  SELECT owner_id INTO assigned_promoter FROM public.events WHERE id=p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento não encontrado.'; END IF;
  IF p_approve THEN
    IF assigned_promoter IS NULL OR assigned_promoter=auth.uid()
       OR NOT public.has_role(assigned_promoter,'promoter')
       OR public.has_role(assigned_promoter,'admin') OR public.has_role(assigned_promoter,'staff')
       OR public.has_role(assigned_promoter,'consumer_support') OR public.has_role(assigned_promoter,'promoter_support') THEN
      RAISE EXCEPTION 'Associe primeiro uma conta de Promotor responsável diferente da Administração.';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.event_contracts WHERE event_id=p_event AND promoter_id=assigned_promoter
      AND signed_at IS NOT NULL AND length(trim(coalesce(signed_name,'')))>=3) THEN
      RAISE EXCEPTION 'O Promotor responsável ainda não assinou o contrato. A assinatura da Administração só pode ser feita depois.';
    END IF;
  END IF;
  SELECT coalesce(nullif(trim(full_name),''),email,'MY Tickets') INTO nm FROM public.profiles WHERE id=auth.uid();
  UPDATE public.events SET approval_status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    approval_note=nullif(trim(coalesce(p_note,'')),''),published=CASE WHEN p_approve THEN published ELSE false END
  WHERE id=p_event;
  IF p_approve THEN
    UPDATE public.event_contracts SET admin_signed_by=auth.uid(),admin_signed_name=coalesce(nm,'MY Tickets'),admin_signed_at=now()
    WHERE event_id=p_event AND promoter_id=assigned_promoter AND admin_signed_at IS NULL;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.sign_contract(uuid,boolean,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_contract(uuid,boolean,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.review_event(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_event(uuid,boolean,text) TO authenticated;
