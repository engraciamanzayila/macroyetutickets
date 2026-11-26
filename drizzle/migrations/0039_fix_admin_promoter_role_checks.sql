-- Fix role checks for users other than the current administrator.
-- public.has_role() intentionally only checks auth.uid(); it must not be used
-- to inspect another user's role from an admin workflow.

CREATE OR REPLACE FUNCTION public.assign_event_promoter(
  p_event uuid,
  p_promoter uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_row public.events;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_promoter IS NULL OR p_promoter = auth.uid() THEN
    RAISE EXCEPTION 'O administrador não pode ser o promotor do evento.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_promoter) THEN
    RAISE EXCEPTION 'A conta indicada ainda não existe na MY Tickets.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_promoter
      AND role IN ('admin','staff','consumer_support','promoter_support')
  ) THEN
    RAISE EXCEPTION 'Esta conta tem um perfil interno ou administrativo e não pode ser associada como promotor.';
  END IF;

  SELECT * INTO event_row
  FROM public.events
  WHERE id = p_event
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  IF event_row.published OR event_row.approval_status = 'approved' THEN
    RAISE EXCEPTION 'A atribuição do responsável deve ser feita antes da aprovação e publicação.';
  END IF;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (p_promoter, 'promoter')
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.events
  SET owner_id = p_promoter,
      promoter_assigned_by = auth.uid(),
      promoter_assigned_at = now()
  WHERE id = p_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_event(p_event uuid,p_approve boolean,p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nm text;
  assigned_promoter uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Apenas a Administração pode rever e assinar pela plataforma.';
  END IF;

  SELECT owner_id INTO assigned_promoter
  FROM public.events
  WHERE id = p_event
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  IF p_approve THEN
    IF assigned_promoter IS NULL OR assigned_promoter = auth.uid()
       OR NOT EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = assigned_promoter AND role = 'promoter'
       )
       OR EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = assigned_promoter
           AND role IN ('admin','staff','consumer_support','promoter_support')
       ) THEN
      RAISE EXCEPTION 'Associe primeiro uma conta de Promotor responsável diferente da Administração.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.event_contracts
      WHERE event_id = p_event
        AND promoter_id = assigned_promoter
        AND signed_at IS NOT NULL
        AND length(trim(coalesce(signed_name,''))) >= 3
    ) THEN
      RAISE EXCEPTION 'O Promotor responsável ainda não assinou o contrato. A assinatura da Administração só pode ser feita depois.';
    END IF;
  END IF;

  SELECT coalesce(nullif(trim(full_name),''),email,'MY Tickets')
  INTO nm
  FROM public.profiles
  WHERE id = auth.uid();

  UPDATE public.events
  SET approval_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      approval_note = nullif(trim(coalesce(p_note,'')),''),
      published = CASE WHEN p_approve THEN published ELSE false END
  WHERE id = p_event;

  IF p_approve THEN
    UPDATE public.event_contracts
    SET admin_signed_by = auth.uid(),
        admin_signed_name = coalesce(nm,'MY Tickets'),
        admin_signed_at = now()
    WHERE event_id = p_event
      AND promoter_id = assigned_promoter
      AND admin_signed_at IS NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_event_promoter(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_event_promoter(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.review_event(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_event(uuid,boolean,text) TO authenticated;
