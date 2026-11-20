CREATE OR REPLACE FUNCTION public.review_promoter_payout(p_request uuid,p_decision text,p_note text DEFAULT NULL,p_reference text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Apenas a administração pode tratar levantamentos'; END IF;
  IF p_decision NOT IN ('approved','rejected','paid') THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
  IF p_decision='paid' AND length(trim(coalesce(p_reference,'')))<3 THEN RAISE EXCEPTION 'Registe a referência do pagamento efectuado'; END IF;
  UPDATE public.promoter_payout_requests SET status=p_decision,
    admin_note=nullif(trim(coalesce(p_note,'')),''),
    payment_reference=CASE WHEN p_decision='paid' THEN trim(p_reference) ELSE payment_reference END,
    reviewed_by=auth.uid(), reviewed_at=now(),
    paid_at=CASE WHEN p_decision='paid' THEN now() ELSE paid_at END
  WHERE id=p_request
    AND ((p_decision IN ('approved','rejected') AND status='pending')
      OR (p_decision='paid' AND status='approved'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já tratado; só pedidos pendentes podem ser aprovados/recusados e só pedidos aprovados podem ser pagos'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.review_promoter_payout(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_promoter_payout(uuid,text,text,text) TO authenticated;
