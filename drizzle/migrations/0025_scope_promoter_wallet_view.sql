CREATE OR REPLACE VIEW public.promoter_wallet_summary
WITH (security_invoker=true) AS
WITH paid_orders AS (
  SELECT o.event_id, count(*)::bigint AS paid_orders,
    coalesce(sum(o.total),0)::numeric AS gross_sales
  FROM public.orders o
  WHERE o.status='paid'
  GROUP BY o.event_id
),
paid_tickets AS (
  SELECT o.event_id, coalesce(sum(oi.quantity),0)::bigint AS paid_tickets
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id=o.id
  WHERE o.status='paid'
  GROUP BY o.event_id
)
SELECT coalesce(e.owner_id,e.created_by) AS promoter_id,
  e.id AS event_id,
  e.name AS event_name,
  coalesce(po.paid_orders,0) AS paid_orders,
  coalesce(pt.paid_tickets,0) AS paid_tickets,
  coalesce(po.gross_sales,0)::numeric(14,2) AS gross_sales,
  coalesce(ec.commission_pct,e.commission_pct,5)::numeric(5,2) AS platform_commission_pct,
  round(coalesce(po.gross_sales,0)*coalesce(ec.commission_pct,e.commission_pct,5)/100,2)::numeric(14,2) AS platform_commission_amount,
  round(coalesce(po.gross_sales,0)*(1-coalesce(ec.commission_pct,e.commission_pct,5)/100),2)::numeric(14,2) AS estimated_promoter_share
FROM public.events e
LEFT JOIN paid_orders po ON po.event_id=e.id
LEFT JOIN paid_tickets pt ON pt.event_id=e.id
LEFT JOIN public.event_contracts ec ON ec.event_id=e.id
WHERE coalesce(e.owner_id,e.created_by)=auth.uid()
   OR public.has_role(auth.uid(),'admin');
