-- Promoter/admin communication and a transparent sales/commission wallet view.
CREATE TABLE IF NOT EXISTS public.promoter_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.promoter_applications(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promoter_messages_application_created_idx
  ON public.promoter_messages(application_id, created_at);
ALTER TABLE public.promoter_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.promoter_messages TO authenticated;
REVOKE UPDATE, DELETE ON public.promoter_messages FROM authenticated;
DROP POLICY IF EXISTS "promoter messages participants read" ON public.promoter_messages;
CREATE POLICY "promoter messages participants read" ON public.promoter_messages
  FOR SELECT TO authenticated USING (
    (SELECT public.has_role((SELECT auth.uid()),'admin'))
    OR EXISTS (
      SELECT 1 FROM public.promoter_applications a
      WHERE a.id=application_id AND a.user_id=(SELECT auth.uid())
    )
  );
DROP POLICY IF EXISTS "promoter messages owner or admin send" ON public.promoter_messages;
CREATE POLICY "promoter messages owner or admin send" ON public.promoter_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id=(SELECT auth.uid())
    AND (
      (SELECT public.has_role((SELECT auth.uid()),'admin'))
      OR EXISTS (
        SELECT 1 FROM public.promoter_applications a
        WHERE a.id=application_id AND a.user_id=(SELECT auth.uid())
      )
    )
  );

CREATE OR REPLACE VIEW public.promoter_wallet_summary
WITH (security_invoker=true) AS
WITH paid AS (
  SELECT o.event_id,
    count(DISTINCT o.id)::bigint AS paid_orders,
    coalesce(sum(oi.quantity),0)::bigint AS paid_tickets,
    coalesce(sum(o.total),0)::numeric AS gross_sales
  FROM public.orders o
  LEFT JOIN public.order_items oi ON oi.order_id=o.id
  WHERE o.status='paid'
  GROUP BY o.event_id
)
SELECT coalesce(e.owner_id,e.created_by) AS promoter_id,
  e.id AS event_id,
  e.name AS event_name,
  coalesce(p.paid_orders,0) AS paid_orders,
  coalesce(p.paid_tickets,0) AS paid_tickets,
  coalesce(p.gross_sales,0)::numeric(14,2) AS gross_sales,
  coalesce(ec.commission_pct,e.commission_pct,5)::numeric(5,2) AS platform_commission_pct,
  round(coalesce(p.gross_sales,0)*coalesce(ec.commission_pct,e.commission_pct,5)/100,2)::numeric(14,2) AS platform_commission_amount,
  round(coalesce(p.gross_sales,0)*(1-coalesce(ec.commission_pct,e.commission_pct,5)/100),2)::numeric(14,2) AS estimated_promoter_share
FROM public.events e
LEFT JOIN paid p ON p.event_id=e.id
LEFT JOIN public.event_contracts ec ON ec.event_id=e.id
WHERE coalesce(e.owner_id,e.created_by) IS NOT NULL;
GRANT SELECT ON public.promoter_wallet_summary TO authenticated;
