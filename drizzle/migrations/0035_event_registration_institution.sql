-- Optional, event-configured registration fields. Existing events retain their current checkout.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS registration_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS buyer_institution text;

UPDATE public.events
SET registration_fields = jsonb_build_object('institution', true)
WHERE slug = 'forum-juvenil-literacia-digital-cidadania-global-2026';

CREATE OR REPLACE FUNCTION public.create_cart_orders(
  p_items jsonb,
  p_name text,
  p_phone text,
  p_email text,
  p_method text,
  p_delivery text,
  p_institution text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cart_event record;
  created_order jsonb;
  event_name text;
  order_total numeric;
  created_orders jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Carrinho inválido';
  END IF;
  IF jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'O carrinho deve conter entre 1 e 100 linhas';
  END IF;

  FOR cart_event IN
    SELECT grouped.event_id,
      jsonb_agg(jsonb_build_object(
        'group_id', grouped.group_id,
        'quantity', grouped.quantity
      ) ORDER BY grouped.group_id) AS items
    FROM (
      SELECT
        (entry.item->>'event_id')::uuid AS event_id,
        (entry.item->>'group_id')::uuid AS group_id,
        sum((entry.item->>'quantity')::integer)::integer AS quantity
      FROM jsonb_array_elements(p_items) AS entry(item)
      GROUP BY
        (entry.item->>'event_id')::uuid,
        (entry.item->>'group_id')::uuid
    ) AS grouped
    GROUP BY grouped.event_id
  LOOP
    created_order := public.create_order(
      cart_event.event_id,
      cart_event.items,
      p_name,
      p_phone,
      p_email,
      p_method,
      p_delivery
    );

    UPDATE public.orders
    SET buyer_institution = nullif(left(trim(coalesce(p_institution, '')), 180), '')
    WHERE id = (created_order->>'id')::uuid;

    SELECT e.name, o.total
      INTO event_name, order_total
      FROM public.events e
      JOIN public.orders o ON o.event_id = e.id
      WHERE o.id = (created_order->>'id')::uuid;

    created_orders := created_orders || jsonb_build_array(
      created_order || jsonb_build_object(
        'event_id', cart_event.event_id,
        'event_name', event_name,
        'total', order_total
      )
    );
  END LOOP;

  RETURN jsonb_build_object('orders', created_orders);
END
$$;

GRANT EXECUTE ON FUNCTION public.create_cart_orders(jsonb, text, text, text, text, text, text)
  TO anon, authenticated;
