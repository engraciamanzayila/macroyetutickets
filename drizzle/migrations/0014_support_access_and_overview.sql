CREATE OR REPLACE FUNCTION public.can_view_event(_uid uuid, _event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'staff') OR public.has_role(_uid,'consumer_support') OR public.has_role(_uid,'promoter_support') OR public.can_manage_event(_uid,_event)
$$;

CREATE POLICY "consumer support read orders" ON public.orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'consumer_support'));
CREATE POLICY "consumer support read items" ON public.order_items FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'consumer_support'));
CREATE POLICY "promoter support read profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'promoter_support'));

CREATE OR REPLACE FUNCTION public.ticket_overview()
RETURNS TABLE(event_id uuid, event_name text, event_date date, group_id uuid, group_name text, ticket_type text, planned integer, generated bigint, printed bigint, digital_sent bigint, sold bigint, used bigint, voided bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.name, e.event_date, g.id, g.name, g.ticket_type, g.quantity,
    count(t.id), count(t.id) FILTER (WHERE t.printed_at IS NOT NULL),
    count(t.id) FILTER (WHERE t.printed_at IS NULL AND (t.sent_at IS NOT NULL OR t.email_sent_at IS NOT NULL)),
    count(t.id) FILTER (WHERE t.order_id IS NOT NULL),
    count(t.id) FILTER (WHERE t.status = 'used'),
    count(t.id) FILTER (WHERE t.status = 'void')
  FROM public.events e
  JOIN public.ticket_groups g ON g.event_id = e.id
  LEFT JOIN public.tickets t ON t.group_id = g.id
  WHERE public.can_view_event(auth.uid(), e.id)
  GROUP BY e.id, g.id
  ORDER BY e.event_date DESC NULLS LAST, e.name, g.created_at
$$;
REVOKE ALL ON FUNCTION public.ticket_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ticket_overview() TO authenticated;