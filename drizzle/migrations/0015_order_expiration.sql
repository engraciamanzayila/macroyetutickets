ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE public.orders SET expires_at = created_at + interval '24 hours' WHERE expires_at IS NULL;
ALTER TABLE public.orders ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');
ALTER TABLE public.orders ALTER COLUMN expires_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.expire_stale_orders() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.orders SET status = 'expired' WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.expire_stale_orders() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.group_available(_group uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT greatest(0,g.quantity - greatest(COALESCE((SELECT SUM(i.quantity) FROM public.order_items i JOIN public.orders o ON o.id=i.order_id WHERE i.group_id=g.id AND (o.status='paid' OR (o.status='pending' AND o.expires_at > now()))),0)::int, (SELECT count(*)::int FROM public.tickets t WHERE t.group_id=g.id AND t.order_id IS NULL))) FROM public.ticket_groups g WHERE g.id=_group $$;

CREATE OR REPLACE FUNCTION public.get_order(p_token uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT jsonb_build_object('id',o.id,'status',CASE WHEN o.status='pending' AND o.expires_at < now() THEN 'expired' ELSE o.status END,'expires_at',o.expires_at,'total',o.total,'buyer_name',o.buyer_name,'payment_method',o.payment_method,'payment_reference',o.payment_reference,'created_at',o.created_at,'event',jsonb_build_object('name',e.name,'event_date',e.event_date,'event_time',e.event_time,'venue',e.venue,'city',e.city,'payment_info',e.payment_info),'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',g.name,'type',g.ticket_type,'quantity',i.quantity,'unit_price',i.unit_price)) FROM public.order_items i JOIN public.ticket_groups g ON g.id=i.group_id WHERE i.order_id=o.id),'[]'::jsonb),'tickets',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',t.code,'status',t.status,'type',g.ticket_type,'group',g.name,'token',t.share_token) ORDER BY t.seq) FROM public.tickets t JOIN public.ticket_groups g ON g.id=t.group_id WHERE t.order_id=o.id),'[]'::jsonb)) FROM public.orders o JOIN public.events e ON e.id=o.event_id WHERE o.access_token=p_token $$;

CREATE OR REPLACE FUNCTION public.submit_payment_reference(p_token uuid, p_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders SET payment_reference = left(trim(p_ref), 200)
  WHERE access_token = p_token AND status = 'pending' AND expires_at > now();
  IF NOT FOUND AND EXISTS (SELECT 1 FROM public.orders WHERE access_token = p_token AND status = 'pending') THEN
    RAISE EXCEPTION 'Encomenda expirada. Faça uma nova encomenda.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_order(p_event uuid, p_items jsonb, p_name text, p_phone text, p_email text, p_method text, p_delivery text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o_id uuid; tok uuid; it jsonb; g public.ticket_groups; q int; tot numeric := 0;
BEGIN
  PERFORM public.expire_stale_orders();
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