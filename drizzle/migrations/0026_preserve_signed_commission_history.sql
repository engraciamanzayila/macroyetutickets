-- MY Tickets: enforce current commission rates without rewriting finalized historical contracts.
-- Historical contracts already countersigned by MY Tickets retain the legacy agreed rates.
UPDATE public.event_contracts
SET commission_pct = CASE WHEN exclusive THEN 8 ELSE 10 END
WHERE admin_signed_at IS NOT NULL;

-- Unsigned / not-yet-finalized contracts adopt the current commercial policy.
UPDATE public.event_contracts
SET commission_pct = CASE WHEN exclusive THEN 3.5 ELSE 5 END
WHERE admin_signed_at IS NULL;

UPDATE public.events e
SET commission_pct = CASE WHEN c.exclusive THEN 8 ELSE 10 END
FROM public.event_contracts c
WHERE c.event_id = e.id AND c.admin_signed_at IS NOT NULL;

UPDATE public.events e
SET commission_pct = CASE WHEN c.exclusive THEN 3.5 ELSE 5 END
FROM public.event_contracts c
WHERE c.event_id = e.id AND c.admin_signed_at IS NULL;

ALTER TABLE public.events ALTER COLUMN commission_pct SET DEFAULT 5;
ALTER TABLE public.event_contracts ALTER COLUMN commission_pct SET DEFAULT 5;

CREATE OR REPLACE FUNCTION public.events_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('app.bypass', true)='1' OR public.has_role(auth.uid(),'admin') OR auth.uid() IS NULL THEN
    IF NEW.approval_status IN ('approved','rejected') AND (TG_OP='INSERT' OR OLD.approval_status IS DISTINCT FROM NEW.approval_status) THEN
      NEW.approved_by:=auth.uid();
      NEW.approved_at:=now();
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.commission_pct:=5;
    NEW.approval_status:='draft';
    NEW.published:=false;
    RETURN NEW;
  END IF;
  NEW.commission_pct:=OLD.commission_pct;
  IF NEW.approval_status<>OLD.approval_status AND NEW.approval_status NOT IN ('draft','submitted') THEN
    NEW.approval_status:=OLD.approval_status;
  END IF;
  IF NEW.published AND NEW.approval_status<>'approved' THEN
    RAISE EXCEPTION 'O evento precisa de aprovação da administração antes de ser publicado';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sign_contract(p_event uuid,p_exclusive boolean,p_data jsonb,p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pct numeric:=CASE WHEN p_exclusive THEN 3.5 ELSE 5 END;
BEGIN
  IF NOT public.can_manage_event(auth.uid(),p_event) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(trim(coalesce(p_name,'')))<3 THEN RAISE EXCEPTION 'Escreva o nome completo para assinar'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_contracts WHERE event_id=p_event AND admin_signed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Contrato já aprovado — não pode ser alterado';
  END IF;
  INSERT INTO public.event_contracts(event_id,promoter_id,exclusive,commission_pct,data,signed_name)
  VALUES(p_event,auth.uid(),p_exclusive,pct,coalesce(p_data,'{}'),trim(p_name))
  ON CONFLICT(event_id) DO UPDATE SET
    exclusive=EXCLUDED.exclusive,
    commission_pct=EXCLUDED.commission_pct,
    data=EXCLUDED.data,
    signed_name=EXCLUDED.signed_name,
    signed_at=now(),
    promoter_id=EXCLUDED.promoter_id;
  PERFORM set_config('app.bypass','1',true);
  UPDATE public.events
  SET commission_pct=pct,
      approval_status=CASE WHEN approval_status='approved' THEN approval_status ELSE 'submitted' END
  WHERE id=p_event;
  PERFORM set_config('app.bypass','0',true);
END $$;
