CREATE OR REPLACE FUNCTION public.get_order(p_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'status', CASE WHEN o.status = 'pending' AND o.expires_at < now() THEN 'expired' ELSE o.status END,
    'expires_at', o.expires_at,
    'total', o.total,
    'buyer_name', o.buyer_name,
    'payment_method', o.payment_method,
    'payment_reference', o.payment_reference,
    'delivery_channel', o.delivery_channel,
    'created_at', o.created_at,
    'event', jsonb_build_object(
      'name', e.name,
      'event_date', e.event_date,
      'event_time', e.event_time,
      'venue', e.venue,
      'city', e.city,
      'payment_info', e.payment_info
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', g.name,
        'type', g.ticket_type,
        'quantity', i.quantity,
        'unit_price', i.unit_price
      ))
      FROM public.order_items i
      JOIN public.ticket_groups g ON g.id = i.group_id
      WHERE i.order_id = o.id
    ), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', t.code,
        'status', t.status,
        'type', g.ticket_type,
        'group', g.name,
        'token', t.share_token
      ) ORDER BY t.seq)
      FROM public.tickets t
      JOIN public.ticket_groups g ON g.id = t.group_id
      WHERE t.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.access_token = p_token
$$;
REVOKE ALL ON FUNCTION public.get_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order(uuid) TO anon, authenticated;