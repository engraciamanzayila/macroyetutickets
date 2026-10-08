ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS event_time text,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS payment_info text;
UPDATE public.events SET owner_id = created_by WHERE owner_id IS NULL;

ALTER TABLE public.ticket_groups
  ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS for_sale boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS wants_promoter boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_manage_event(_uid uuid, _event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'admin') OR EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = _event AND e.owner_id = _uid AND public.has_role(_uid,'promoter'))
$$;

CREATE OR REPLACE FUNCTION public.can_view_event(_uid uuid, _event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'staff') OR public.can_manage_event(_uid,_event)
$$;

-- events policies
DROP POLICY IF EXISTS "admin write events" ON public.events;
DROP POLICY IF EXISTS "members read events" ON public.events;
CREATE POLICY "view events" ON public.events FOR SELECT TO authenticated USING (published OR public.can_view_event(auth.uid(), id));
CREATE POLICY "public read published events" ON public.events FOR SELECT TO anon USING (published);
CREATE POLICY "insert events" ON public.events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR (public.has_role(auth.uid(),'promoter') AND owner_id = auth.uid()));
CREATE POLICY "update events" ON public.events FOR UPDATE TO authenticated
  USING (public.can_manage_event(auth.uid(), id)) WITH CHECK (public.has_role(auth.uid(),'admin') OR owner_id = auth.uid());
CREATE POLICY "delete events" ON public.events FOR DELETE TO authenticated USING (public.can_manage_event(auth.uid(), id));
GRANT SELECT ON public.events TO anon;

DROP POLICY IF EXISTS "admin write groups" ON public.ticket_groups;
DROP POLICY IF EXISTS "members read groups" ON public.ticket_groups;
CREATE POLICY "view groups" ON public.ticket_groups FOR SELECT TO authenticated USING (public.can_view_event(auth.uid(), event_id) OR (for_sale AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.published)));
CREATE POLICY "public read groups" ON public.ticket_groups FOR SELECT TO anon USING (for_sale AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.published));
CREATE POLICY "manage groups" ON public.ticket_groups FOR ALL TO authenticated USING (public.can_manage_event(auth.uid(), event_id)) WITH CHECK (public.can_manage_event(auth.uid(), event_id));
GRANT SELECT ON public.ticket_groups TO anon;

DROP POLICY IF EXISTS "admin write tickets" ON public.tickets;
DROP POLICY IF EXISTS "members read tickets" ON public.tickets;
CREATE POLICY "view tickets" ON public.tickets FOR SELECT TO authenticated USING (public.can_view_event(auth.uid(), event_id));
CREATE POLICY "manage tickets" ON public.tickets FOR ALL TO authenticated USING (public.can_manage_event(auth.uid(), event_id)) WITH CHECK (public.can_manage_event(auth.uid(), event_id));

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS order_id uuid;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_user_id uuid,
  buyer_name text NOT NULL,
  buyer_phone text NOT NULL,
  buyer_email text,
  payment_method text NOT NULL,
  delivery_channel text NOT NULL DEFAULT 'email',
  payment_reference text,
  status text NOT NULL DEFAULT 'pending',
  total numeric NOT NULL DEFAULT 0,
  access_token uuid NOT NULL DEFAULT gen_random_uuid(),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage orders" ON public.orders FOR SELECT TO authenticated USING (public.can_manage_event(auth.uid(), event_id) OR buyer_user_id = auth.uid());
CREATE POLICY "update orders" ON public.orders FOR UPDATE TO authenticated USING (public.can_manage_event(auth.uid(), event_id)) WITH CHECK (public.can_manage_event(auth.uid(), event_id));

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.ticket_groups(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  unit_price numeric NOT NULL
);
GRANT SELECT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view items" ON public.order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (public.can_manage_event(auth.uid(), o.event_id) OR o.buyer_user_id = auth.uid())));

CREATE OR REPLACE FUNCTION public.group_available(_group uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.quantity - COALESCE((SELECT SUM(i.quantity) FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
    WHERE i.group_id = g.id AND o.status IN ('pending','paid')),0)::int
  FROM public.ticket_groups g WHERE g.id = _group
$$;
GRANT EXECUTE ON FUNCTION public.group_available(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_order(p_event uuid, p_items jsonb, p_name text, p_phone text, p_email text, p_method text, p_delivery text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o_id uuid; tok uuid; it jsonb; g public.ticket_groups; q int; tot numeric := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event AND published) THEN RAISE EXCEPTION 'Evento indisponível'; END IF;
  IF length(trim(coalesce(p_name,''))) < 2 OR length(trim(coalesce(p_phone,''))) < 6 THEN RAISE EXCEPTION 'Nome e telefone obrigatórios'; END IF;
  INSERT INTO public.orders(event_id, buyer_user_id, buyer_name, buyer_phone, buyer_email, payment_method, delivery_channel)
  VALUES (p_event, auth.uid(), trim(p_name), trim(p_phone), nullif(trim(coalesce(p_email,'')),''), p_method, coalesce(p_delivery,'email'))
  RETURNING id, access_token INTO o_id, tok;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    q := (it->>'quantity')::int;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > 20 THEN RAISE EXCEPTION 'Máximo 20 por tipo'; END IF;
    SELECT * INTO g FROM public.ticket_groups WHERE id = (it->>'group_id')::uuid AND event_id = p_event AND for_sale FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ingresso inválido'; END IF;
    IF public.group_available(g.id) < q THEN RAISE EXCEPTION 'Esgotado: %', g.name; END IF;
    INSERT INTO public.order_items(order_id, group_id, quantity, unit_price) VALUES (o_id, g.id, q, g.price);
    tot := tot + q * g.price;
  END LOOP;
  IF tot = 0 AND NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = o_id) THEN RAISE EXCEPTION 'Escolha pelo menos um ingresso'; END IF;
  UPDATE public.orders SET total = tot WHERE id = o_id;
  RETURN jsonb_build_object('id', o_id, 'token', tok);
END $$;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, jsonb, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_payment_reference(p_token uuid, p_ref text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.orders SET payment_reference = left(trim(p_ref), 200) WHERE access_token = p_token AND status = 'pending'
$$;
GRANT EXECUTE ON FUNCTION public.submit_payment_reference(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_order(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', o.id, 'status', o.status, 'total', o.total, 'buyer_name', o.buyer_name, 'payment_method', o.payment_method,
    'payment_reference', o.payment_reference, 'created_at', o.created_at,
    'event', jsonb_build_object('name', e.name, 'event_date', e.event_date, 'event_time', e.event_time, 'venue', e.venue, 'city', e.city, 'payment_info', e.payment_info),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', g.name, 'type', g.ticket_type, 'quantity', i.quantity, 'unit_price', i.unit_price))
       FROM public.order_items i JOIN public.ticket_groups g ON g.id = i.group_id WHERE i.order_id = o.id), '[]'::jsonb),
    'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', t.code, 'status', t.status, 'type', g.ticket_type, 'group', g.name) ORDER BY t.seq)
       FROM public.tickets t JOIN public.ticket_groups g ON g.id = t.group_id WHERE t.order_id = o.id), '[]'::jsonb))
  FROM public.orders o JOIN public.events e ON e.id = o.event_id WHERE o.access_token = p_token
$$;
GRANT EXECUTE ON FUNCTION public.get_order(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_order(p_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.orders; it record; s int; n int; c text; alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(auth.uid(), o.event_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF o.status <> 'pending' THEN RETURN; END IF;
  FOR it IN SELECT * FROM public.order_items WHERE order_id = o.id LOOP
    SELECT COALESCE(MAX(seq),0) INTO s FROM public.tickets WHERE group_id = it.group_id;
    FOR n IN 1..it.quantity LOOP
      LOOP
        c := 'ONL-' || (SELECT string_agg(substr(alpha, 1 + floor(random()*32)::int, 1), '') FROM generate_series(1,4)) || '-' ||
             (SELECT string_agg(substr(alpha, 1 + floor(random()*32)::int, 1), '') FROM generate_series(1,4));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tickets WHERE event_id = o.event_id AND code = c);
      END LOOP;
      s := s + 1;
      INSERT INTO public.tickets(event_id, group_id, code, seq, order_id) VALUES (o.event_id, it.group_id, c, s, o.id);
    END LOOP;
  END LOOP;
  UPDATE public.orders SET status = 'paid', paid_at = now() WHERE id = o.id;
END $$;
GRANT EXECUTE ON FUNCTION public.confirm_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in(p_event uuid, p_code text, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t public.tickets; g public.ticket_groups;
BEGIN
  IF NOT public.can_view_event(auth.uid(), p_event) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO t FROM public.tickets WHERE event_id = p_event AND code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','not_found'); END IF;
  SELECT * INTO g FROM public.ticket_groups WHERE id = t.group_id;
  IF t.status = 'void' THEN
    RETURN jsonb_build_object('result','void','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient);
  ELSIF t.status = 'used' THEN
    RETURN jsonb_build_object('result','used','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient,'used_at',t.used_at);
  END IF;
  UPDATE public.tickets SET status='used', used_at=COALESCE(p_at, now()), used_by=auth.uid() WHERE id=t.id;
  RETURN jsonb_build_object('result','ok','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient);
END $function$;