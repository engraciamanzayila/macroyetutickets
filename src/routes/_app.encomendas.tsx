import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { kz, methodLabel, STATUS_LABEL } from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/encomendas")({
  head: () => ({
    meta: [
      { title: "Vendas — MACRO YETU TICKETs" },
      { name: "description", content: "Encomendas de ingressos e confirmação de pagamentos." },
      { property: "og:title", content: "Vendas — MACRO YETU TICKETs" },
      { property: "og:description", content: "Encomendas e pagamentos." },
    ],
  }),
  component: Orders,
});

function Orders() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => (await supabase.from("orders").select("*, events(name, commission_pct)").order("created_at", { ascending: false })).data ?? [],
  });
  const confirm = async (id: string) => {
    const { error } = await supabase.rpc("confirm_order", { p_order: id });
    if (error) return toast.error(error.message);
    toast.success("Pagamento confirmado — ingressos emitidos");
    qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const cancel = async (id: string) => {
    const { error } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const paid = data.filter((o) => o.status === "paid");
  const total = paid.reduce((s, o) => s + Number(o.total), 0);
  const fee = paid.reduce((s, o) => s + Number(o.total) * Number((o.events as { commission_pct: number } | null)?.commission_pct ?? 10) / 100, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Vendas</h1>
        <p className="text-muted-foreground text-sm">Confirme os pagamentos recebidos para emitir os ingressos.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[["Vendido", kz(total)], ["Comissão plataforma", kz(fee)], ["Para o promotor", kz(total - fee)]].map(([l, v]) => (
          <div key={l} className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-bold">{v}</p></div>
        ))}
      </div>
      {isLoading ? <p className="text-muted-foreground">A carregar…</p> : data.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">Ainda não há encomendas.</div>
      ) : (
        <div className="rounded-2xl border bg-card divide-y">
          {data.map((o) => (
            <div key={o.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold">{o.buyer_name} · {kz(Number(o.total))}</p>
                <p className="text-xs text-muted-foreground">{(o.events as { name: string } | null)?.name} · {methodLabel(o.payment_method)} · {o.buyer_phone} · {new Date(o.created_at).toLocaleString("pt-PT")}</p>
                {o.payment_reference && <p className="text-xs">Comprovativo: {o.payment_reference}</p>}
              </div>
              <Badge variant={o.status === "paid" ? "default" : "secondary"}>{STATUS_LABEL[o.status] ?? o.status}</Badge>
              {o.status === "pending" && (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => confirm(o.id)}>Confirmar pagamento</Button>
                  <Button size="sm" variant="ghost" onClick={() => cancel(o.id)}>Cancelar</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
