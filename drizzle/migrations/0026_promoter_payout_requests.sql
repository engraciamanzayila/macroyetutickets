CREATE TABLE IF NOT EXISTS public.promoter_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer','multicaixa_express')),
  destination_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  admin_note text,
  payment_reference text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promoter_payout_requests_owner_idx ON public.promoter_payout_requests(promoter_id,created_at DESC);
CREATE INDEX IF NOT EXISTS promoter_payout_requests_status_idx ON public.promoter_payout_requests(status,created_at);
ALTER TABLE public.promoter_payout_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.promoter_payout_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.promoter_payout_requests FROM authenticated;
GRANT ALL ON public.promoter_payout_requests TO service_role;
DROP POLICY IF EXISTS "promoter payout owner or admin read" ON public.promoter_payout_requests;
CREATE POLICY "promoter payout owner or admin read" ON public.promoter_payout_requests FOR SELECT TO authenticated
  USING (promoter_id=(SELECT auth.uid()) OR public.has_role((SELECT auth.uid()),'admin'));

CREATE OR REPLACE FUNCTION public.request_promoter_payout(p_amount numeric,p_method text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE app public.promoter_applications; destination jsonb; balance numeric; reserved numeric; request_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'promoter') THEN RAISE EXCEPTION 'Apenas promotores aprovados podem solicitar levantamento'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_method NOT IN ('bank_transfer','multicaixa_express') THEN RAISE EXCEPTION 'Valor ou método de pagamento inválido'; END IF;
  SELECT * INTO app FROM public.promoter_applications WHERE user_id=auth.uid() AND status='approved' ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'É necessária uma candidatura aprovada'; END IF;
  IF p_method='bank_transfer' THEN
    IF length(trim(coalesce(app.application_data->>'iban','')))<8 THEN RAISE EXCEPTION 'Não existe IBAN válido na candidatura'; END IF;
    destination:=jsonb_build_object('bank_name',app.application_data->>'bank_name','account_holder',app.application_data->>'account_holder','iban',app.application_data->>'iban');
  ELSE
    IF length(trim(coalesce(app.application_data->>'express_phone','')))<6 THEN RAISE EXCEPTION 'Não existe número Multicaixa Express na candidatura'; END IF;
    destination:=jsonb_build_object('phone',app.application_data->>'express_phone','holder',app.application_data->>'full_name');
  END IF;
  SELECT coalesce(sum(estimated_promoter_share),0) INTO balance
    FROM public.promoter_wallet_summary WHERE promoter_id=auth.uid();
  SELECT coalesce(sum(amount),0) INTO reserved FROM public.promoter_payout_requests
    WHERE promoter_id=auth.uid() AND status IN ('pending','approved','paid');
  IF p_amount > balance-reserved THEN RAISE EXCEPTION 'O valor solicitado ultrapassa a quota estimada disponível'; END IF;
  INSERT INTO public.promoter_payout_requests(promoter_id,amount,payment_method,destination_snapshot)
  VALUES(auth.uid(),round(p_amount,2),p_method,destination) RETURNING id INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.request_promoter_payout(numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_promoter_payout(numeric,text) TO authenticated;

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
  WHERE id=p_request AND (p_decision<>'paid' OR status='approved');
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou ainda não aprovado para pagamento'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.review_promoter_payout(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_promoter_payout(uuid,text,text,text) TO authenticated;
