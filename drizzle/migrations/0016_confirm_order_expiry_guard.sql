CREATE OR REPLACE FUNCTION public.confirm_order(p_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.orders; it record; s int; n int; c text; alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(auth.uid(), o.event_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF o.status <> 'pending' THEN RETURN; END IF;
  IF o.expires_at < now() THEN
    UPDATE public.orders SET status = 'expired' WHERE id = o.id;
    RAISE EXCEPTION 'Encomenda expirada. O prazo de pagamento terminou; cancele-a ou peça ao comprador uma nova encomenda.';
  END IF;
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