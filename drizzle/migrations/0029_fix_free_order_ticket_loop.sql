CREATE OR REPLACE FUNCTION public.create_order(
  p_event uuid, p_items jsonb, p_name text, p_phone text, p_email text, p_method text, p_delivery text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o_id uuid; tok uuid; it jsonb; ticket_item record; g public.ticket_groups; q integer; tot numeric := 0;
  ticket_seq integer; ticket_number integer; ticket_code text;
  alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  PERFORM public.expire_stale_orders();
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event AND published AND approval_status = 'approved') THEN
    RAISE EXCEPTION 'Evento indisponível';
  END IF;
  IF length(trim(coalesce(p_name, ''))) < 2 OR length(trim(coalesce(p_phone, ''))) < 6 THEN
    RAISE EXCEPTION 'Nome e telefone obrigatórios';
  END IF;
  IF coalesce(p_delivery, 'email') = 'email'
     AND coalesce(trim(p_email), '') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Indique um e-mail válido para receber os ingressos';
  END IF;
  INSERT INTO public.orders(event_id,buyer_user_id,buyer_name,buyer_phone,buyer_email,payment_method,delivery_channel)
  VALUES(p_event,auth.uid(),trim(p_name),trim(p_phone),nullif(trim(coalesce(p_email,'')),''),coalesce(nullif(trim(p_method),''),'manual'),coalesce(p_delivery,'email'))
  RETURNING id,access_token INTO o_id,tok;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Seleção de ingressos inválida';
  END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(p_items) AS items(value) LOOP
    q := (it->>'quantity')::integer;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > 20 THEN RAISE EXCEPTION 'Máximo 20 por tipo'; END IF;
    SELECT * INTO g FROM public.ticket_groups WHERE id=(it->>'group_id')::uuid AND event_id=p_event AND for_sale FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ingresso inválido'; END IF;
    IF public.group_available(g.id) < q THEN RAISE EXCEPTION 'Esgotado: %',g.name; END IF;
    INSERT INTO public.order_items(order_id,group_id,quantity,unit_price) VALUES(o_id,g.id,q,g.price);
    tot := tot + q*g.price;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id=o_id) THEN RAISE EXCEPTION 'Escolha pelo menos um ingresso'; END IF;
  UPDATE public.orders SET total=tot WHERE id=o_id;
  IF tot=0 THEN
    FOR ticket_item IN
      SELECT oi.group_id,oi.quantity FROM public.order_items oi
      WHERE oi.order_id=o_id ORDER BY oi.group_id
    LOOP
      SELECT COALESCE(MAX(t.seq),0) INTO ticket_seq FROM public.tickets t WHERE t.group_id=ticket_item.group_id;
      FOR ticket_number IN 1..ticket_item.quantity LOOP
        LOOP
          ticket_code := 'ONL-' ||
            (SELECT string_agg(substr(alpha,1+floor(random()*32)::integer,1),'') FROM generate_series(1,4)) || '-' ||
            (SELECT string_agg(substr(alpha,1+floor(random()*32)::integer,1),'') FROM generate_series(1,4));
          EXIT WHEN NOT EXISTS(SELECT 1 FROM public.tickets WHERE event_id=p_event AND code=ticket_code);
        END LOOP;
        ticket_seq := ticket_seq+1;
        INSERT INTO public.tickets(event_id,group_id,code,seq,order_id,holder_name)
        VALUES(p_event,ticket_item.group_id,ticket_code,ticket_seq,o_id,trim(p_name));
      END LOOP;
    END LOOP;
    UPDATE public.orders SET status='paid',paid_at=now() WHERE id=o_id;
  END IF;
  RETURN jsonb_build_object('id',o_id,'token',tok);
END;
$$;
REVOKE ALL ON FUNCTION public.create_order(uuid,jsonb,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order(uuid,jsonb,text,text,text,text,text) TO anon,authenticated;