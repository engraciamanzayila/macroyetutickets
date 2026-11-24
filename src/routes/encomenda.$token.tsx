import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StoreHeader } from "@/components/store/StoreHeader";
import { getOrderHolderTickets, getHolderTickets } from "@/lib/shares.functions";
import { createPdfBase64 } from "@/lib/share-render";
import { sendFreeOrderTicketEmail } from "@/lib/order-email.functions";
import { downloadPdf, type RenderGroup } from "@/lib/share-render";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { kz, methodLabel, STATUS_LABEL } from "@/lib/payments";

export type PublicOrder = {
  id: string;
  status: string;
  expires_at: string | null;
  total: number;
  buyer_name: string;
  payment_method: string;
  payment_reference: string | null;
  event: { name: string; payment_info: string | null };
  items: { name: string; quantity: number; unit_price: number }[];
  tickets: { code: string; token: string; status: string }[];
};

export async function readOrder(token: string) {
  if (!/^[\da-f-]{36}$/i.test(token)) throw new Error("Link inválido");
  const { data, error } = await supabase.rpc("get_order", { p_token: token });
  if (error) throw error;
  return data as PublicOrder | null;
}

export const Route = createFileRoute("/encomenda/$token")({
  head: () => ({
    meta: [
      { title: "A sua encomenda — MY Tickets" },
      { name: "description", content: "Consulte o pagamento e os ingressos da sua encomenda." },
      { property: "og:title", content: "A sua encomenda — MY Tickets" },
      { property: "og:description", content: "Pagamento e ingressos digitais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { token } = Route.useParams();
  const { data: order, error, isLoading, refetch } = useQuery({
    queryKey: ["order", token],
    queryFn: () => readOrder(token),
    retry: false,
  });
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const resendFreeEmail = async () => {
    if (!order) return;
    setEmailBusy(true);
    try {
      let attachment: { fileName: string; base64: string } | null = null;
      if (order.tickets.length <= 10) {
        const holder = await getHolderTickets({
          data: { tokens: order.tickets.map((ticket) => ticket.token) },
        });
        const base64 = await createPdfBase64(
          holder.tickets.map((ticket) => ({
            g: holder.groups.find((group) => group.id === ticket.group_id) as unknown as RenderGroup,
            code: ticket.code,
            holderName: ticket.holder_name,
          })),
        );
        attachment = { fileName: "MY_Tickets_ingressos.pdf", base64 };
      }
      await sendFreeOrderTicketEmail({ data: { orderToken: token, attachment } });
      toast.success("Os ingressos foram enviados por e-mail.");
      refetch();
    } catch (emailError) {
      toast.error(`Não foi possível enviar o e-mail: ${(emailError as Error).message}`);
    } finally {
      setEmailBusy(false);
    }
  };
  const downloadAll = async () => {
    setDownloadBusy(true);
    try {
      const files = await getOrderHolderTickets({ data: { orderToken: token } });
      const groupOf = (id: string) =>
        files.groups.find((group) => group.id === id) as unknown as RenderGroup;
      await downloadPdf(
        files.tickets.map((ticket) => ({
          g: groupOf(ticket.group_id),
          code: ticket.code,
          holderName: ticket.holder_name,
        })),
        `${files.event.name}_ingressos`,
      );
    } catch (downloadError) {
      toast.error(`Não foi possível preparar os ingressos: ${(downloadError as Error).message}`);
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <>
      <StoreHeader />
      <main className="mx-auto max-w-2xl px-5 py-10">
        {isLoading ? (
          <p>A carregar…</p>
        ) : error || !order ? (
          <p>Encomenda não encontrada.</p>
        ) : (
          <>
            <p className="text-sm text-primary">
              {order.status === "paid" && Number(order.total) === 0
                ? "Reserva gratuita confirmada"
                : STATUS_LABEL[order.status] || order.status}
            </p>
            <h1 className="mt-2 text-3xl font-bold">{order.event.name}</h1>
            <p className="mt-3 text-muted-foreground">{order.buyer_name}</p>
            <div className="my-6 divide-y border-y">
              {order.items.map((i, index) => (
                <div key={index} className="flex justify-between py-4">
                  <span>
                    {i.quantity} × {i.name}
                  </span>
                  <span>{kz(i.unit_price * i.quantity)}</span>
                </div>
              ))}
              <div className="flex justify-between py-4 font-bold">
                <span>Total</span>
                <span>{kz(order.total)}</span>
              </div>
            </div>
            {order.status === "pending" && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold">Pagamento · {methodLabel(order.payment_method)}</h2>
                {order.expires_at && (
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    Pague até {new Date(order.expires_at).toLocaleString("pt-AO")}. Depois deste
                    prazo a encomenda expira e os ingressos voltam a estar disponíveis.
                  </p>
                )}
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {order.event.payment_info ||
                    "As instruções de pagamento ainda não foram disponibilizadas pelo promotor. Aguarde antes de efetuar o pagamento."}
                </p>
                <form
                  className="space-y-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    const { error } = await supabase.rpc("submit_payment_reference", {
                      p_token: token,
                      p_ref: reference,
                    });
                    setBusy(false);
                    if (error) toast.error(error.message);
                    else {
                      toast.success("Referência enviada para verificação");
                      refetch();
                    }
                  }}
                >
                  <Label htmlFor="reference">Referência / identificação da transação</Label>
                  <Input
                    id="reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    required
                  />
                  <Button disabled={busy}>
                    {busy ? "A enviar…" : "Enviar referência de pagamento"}
                  </Button>
                </form>
                {order.payment_reference && (
                  <p className="text-sm text-success">
                    Referência enviada: {order.payment_reference}
                  </p>
                )}
              </div>
            )}
            {order.status === "expired" && (
              <div className="space-y-4 rounded-2xl border border-dashed p-6">
                <h2 className="text-xl font-bold">Encomenda expirada</h2>
                <p className="text-sm text-muted-foreground">
                  O prazo de pagamento terminou e os ingressos voltaram a estar disponíveis. Faça
                  uma nova encomenda se ainda quiser ir ao evento.
                </p>
                <Button asChild variant="secondary">
                  <Link to="/">Ver eventos disponíveis</Link>
                </Button>
              </div>
            )}
            {order.status === "paid" && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold">
                  {Number(order.total) === 0 ? "A sua reserva está confirmada" : "Ingressos disponíveis"}
                </h2>
                {order.tickets.length > 0 && (
                  <>
                    <Button className="w-full" disabled={downloadBusy} onClick={() => void downloadAll()}>
                      {downloadBusy ? "A preparar os ingressos…" : "Descarregar todos os ingressos em PDF"}
                    </Button>
                    {Number(order.total) === 0 && (
                      <Button className="w-full" variant="secondary" disabled={emailBusy} onClick={() => void resendFreeEmail()}>
                        {emailBusy ? "A enviar e-mail…" : "Enviar / reenviar ingressos por e-mail"}
                      </Button>
                    )}
                  </>
                )}
                {order.tickets.map((t) => (
                  <Button asChild key={t.code} variant="secondary">
                    <Link to="/i/$tokens" params={{ tokens: t.token }}>
                      {t.code} · Abrir ingresso
                    </Link>
                  </Button>
                ))}
              </div>
            )}
            <Button className="mt-6" variant="ghost" onClick={() => refetch()}>
              Atualizar estado
            </Button>
          </>
        )}
      </main>
    </>
  );
}
