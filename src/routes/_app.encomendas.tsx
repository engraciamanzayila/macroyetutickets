import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendTicketEmail } from "@/lib/order-email.functions";
import { deliveryLabel, kz, methodLabel, STATUS_LABEL } from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/encomendas")({
  head: () => ({
    meta: [
      { title: "Vendas — MY Tickets" },
      { name: "description", content: "Encomendas de ingressos e confirmação de pagamentos." },
      { property: "og:title", content: "Vendas — MY Tickets" },
      { property: "og:description", content: "Encomendas e pagamentos." },
    ],
  }),
  component: Orders,
});

function Orders() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("*, events(name, commission_pct)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!orders?.length) return [];
      const { data: tickets, error: ticketError } = await supabase
        .from("tickets")
        .select("id,order_id,email_delivery_status,email_delivery_error")
        .in("order_id", orders.map((order) => order.id));
      if (ticketError) throw ticketError;
      return orders.map((order) => ({
        ...order,
        email_tickets: (tickets ?? []).filter((ticket) => ticket.order_id === order.id),
      }));
    },
  });
  const confirm = async (id: string) => {
    const { error } = await supabase.rpc("confirm_order", { p_order: id });
    if (error) return toast.error(error.message);
    const order = data.find((item) => item.id === id);
    if (order?.delivery_channel === "email" && !order.buyer_email) {
      toast.warning("Pagamento confirmado, mas esta encomenda não tem um e-mail de entrega válido.");
    } else if (order?.delivery_channel === "email" && order.buyer_email) {
      const { data: ticketRows, error: ticketError } = await supabase
        .from("tickets")
        .select("id")
        .eq("order_id", id);
      if (ticketError) {
        toast.warning("Pagamento confirmado; não foi possível preparar o e-mail automático.");
      } else {
        try {
          const delivery = await sendTicketEmail({
            data: {
              eventId: order.event_id,
              ticketIds: (ticketRows ?? []).map((ticket) => ticket.id),
              recipient: order.buyer_email,
            },
          });
          toast.success(
            delivery.status === "sent"
              ? "Pagamento confirmado — ingressos enviados por e-mail."
              : "Pagamento confirmado — consulte o estado da entrega de e-mail.",
          );
        } catch (deliveryError) {
          toast.warning(
            `Pagamento confirmado; e-mail não enviado. ${((deliveryError as Error).message ?? "").slice(0, 180)}`,
          );
        }
      }
    } else {
      toast.success("Pagamento confirmado — ingressos emitidos");
    }
    qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const retryEmail = async (order: (typeof data)[number]) => {
    if (!order.buyer_email || !order.email_tickets.length) return;
    try {
      const result = await sendTicketEmail({
        data: {
          eventId: order.event_id,
          ticketIds: order.email_tickets.map((ticket) => ticket.id),
          recipient: order.buyer_email,
        },
      });
      toast.success(`Ingressos enviados para ${result.recipient}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (error) {
      toast.error("O reenvio falhou: " + (error as Error).message);
      qc.invalidateQueries({ queryKey: ["orders"] });
    }
  };
  const cancel = async (id: string) => {
    const { error } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const effectiveStatus = (o: (typeof data)[number]) =>
    o.status === "pending" && o.expires_at && new Date(o.expires_at).getTime() < Date.now()
      ? "expired"
      : o.status;
  const paid = data.filter((o) => o.status === "paid");
  const total = paid.reduce((s, o) => s + Number(o.total), 0);
  const fee = paid.reduce(
    (s, o) =>
      s +
      (Number(o.total) *
        Number((o.events as { commission_pct: number } | null)?.commission_pct ?? 10)) /
        100,
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Vendas</h1>
        <p className="text-muted-foreground text-sm">
          Confirme os pagamentos recebidos para emitir os ingressos.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Vendido", kz(total)],
          ["Comissão plataforma", kz(fee)],
          ["Para o promotor", kz(total - fee)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-2xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="text-lg font-bold">{v}</p>
          </div>
        ))}
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">A carregar…</p>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
          Ainda não há encomendas.
        </div>
      ) : (
        <div className="rounded-2xl border bg-card divide-y">
          {data.map((o) => (
            <div key={o.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold">
                  {o.buyer_name} · {kz(Number(o.total))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(o.events as { name: string } | null)?.name} · {methodLabel(o.payment_method)} ·
                  Entrega: {deliveryLabel(o.delivery_channel)} · {o.buyer_phone}
                  {o.buyer_email ? ` · ${o.buyer_email}` : ""} ·{" "}
                  {new Date(o.created_at).toLocaleString("pt-PT")}
                </p>
                {o.payment_reference && (
                  <p className="text-xs">Comprovativo: {o.payment_reference}</p>
                )}
              </div>
              <Badge variant={o.status === "paid" ? "default" : "secondary"}>
                {STATUS_LABEL[o.status] ?? o.status}
              </Badge>
              {o.delivery_channel === "email" && o.status === "paid" && (
                <Badge variant={o.email_tickets.length > 0 && o.email_tickets.every((ticket) => ticket.email_delivery_status === "sent") ? "default" : "secondary"}>
                  {o.email_tickets.length > 0 && o.email_tickets.every((ticket) => ticket.email_delivery_status === "sent")
                    ? "E-mail enviado"
                    : o.email_tickets.some((ticket) => ticket.email_delivery_status === "failed")
                      ? "E-mail falhou"
                      : "A enviar por e-mail"}
                </Badge>
              )}
              {o.delivery_channel === "email" && o.status === "paid" && o.email_tickets.some((ticket) => ticket.email_delivery_status === "failed") && o.buyer_email && (
                <Button size="sm" variant="secondary" onClick={() => void retryEmail(o)}>
                  Tentar e-mail novamente
                </Button>
              )}
              {o.status === "pending" && (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => confirm(o.id)}>
                    Confirmar pagamento
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => cancel(o.id)}>
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
