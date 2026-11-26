-- Event assignment keeps the creator/audit identity separate from the operational promoter.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS promoter_assigned_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS promoter_assigned_at timestamptz;

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

  IF public.has_role(p_promoter,'admin')
     OR public.has_role(p_promoter,'staff')
     OR public.has_role(p_promoter,'consumer_support')
     OR public.has_role(p_promoter,'promoter_support') THEN
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

REVOKE ALL ON FUNCTION public.assign_event_promoter(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_event_promoter(uuid,uuid) TO authenticated;

-- An event cannot be approved until a separate, eligible promoter account owns it.
CREATE OR REPLACE FUNCTION public.review_event(p_event uuid, p_approve boolean, p_note text)
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
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT owner_id INTO assigned_promoter
  FROM public.events
  WHERE id = p_event
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  IF p_approve THEN
    IF assigned_promoter IS NULL
       OR assigned_promoter = auth.uid()
       OR NOT public.has_role(assigned_promoter,'promoter')
       OR public.has_role(assigned_promoter,'admin')
       OR public.has_role(assigned_promoter,'staff')
       OR public.has_role(assigned_promoter,'consumer_support')
       OR public.has_role(assigned_promoter,'promoter_support') THEN
      RAISE EXCEPTION 'Associe primeiro uma conta de promotor responsável diferente da conta de administrador.';
    END IF;
  END IF;

  SELECT coalesce(full_name,email) INTO nm
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
        admin_signed_name = nm,
        admin_signed_at = now()
    WHERE event_id = p_event;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_event(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_event(uuid,boolean,text) TO authenticated;
