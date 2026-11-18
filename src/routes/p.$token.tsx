import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Download, Mail, Search } from "lucide-react";
import { getShare, markSent } from "@/lib/shares.functions";
import { sendSharedTicketEmail } from "@/lib/order-email.functions";
import { holderLink } from "@/lib/share-render";
import { createTicketFiles, downloadTicketFiles, type TicketFileFormat } from "@/lib/ticket-files";
import type { Group, TicketRow } from "@/lib/generate";
import { WhatsAppShareFlow, type WhatsAppFilePayload } from "@/components/event/WhatsAppShareFlow";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/p/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Portal do parceiro — MY Tickets" },
      { name: "description", content: "Gira e envie os ingressos atribuídos à sua entidade." },
      { property: "og:title", content: "Portal do parceiro — MY Tickets" },
      {
        property: "og:description",
        content: "Gira e envie os ingressos atribuídos à sua entidade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PartnerPortal,
});

const VIA: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  download: "Baixado",
  link: "Link de download",
};

function PartnerPortal() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["share", token],
    queryFn: () => getShare({ data: { token } }),
    retry: false,
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "todo" | "sent" | "used">("todo");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [whatsAppLocked, setWhatsAppLocked] = useState(false);

  const tickets = useMemo(() => data?.tickets ?? [], [data?.tickets]);
  const shown = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          (filter === "all" ||
            (filter === "todo" && !ticket.sent_at && ticket.status !== "used") ||
            (filter === "sent" && ticket.sent_at) ||
            (filter === "used" && ticket.status === "used")) &&
          (!q ||
            ticket.code.includes(q.toUpperCase()) ||
            (ticket.holder_name ?? "").toLowerCase().includes(q.toLowerCase())),
      ),
    [tickets, filter, q],
  );

  if (isLoading)
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">A carregar…</div>
    );
  if (error || !data)
    return (
      <div className="min-h-screen grid place-items-center px-4 text-center">
        <div className="space-y-3">
          <Logo />
          <p>{(error as Error)?.message ?? "Link inválido"}</p>
        </div>
      </div>
    );

  const selected = tickets.filter((ticket) => sel.has(ticket.id));
  const selectedForSharing = selected.filter(
    (ticket) =>
      ticket.status === "valid" &&
      !ticket.sent_at &&
      !ticket.printed_at &&
      ticket.email_delivery_status !== "sending" &&
      ticket.email_delivery_status !== "sent",
  );
  const stats = {
    total: tickets.length,
    sent: tickets.filter((ticket) => ticket.sent_at).length,
    used: tickets.filter((ticket) => ticket.status === "used").length,
  };

  const fileGroup: Group = {
    id: data.share.group_id,
    event_id: data.share.event_id,
    name: data.group?.name ?? "Grupo",
    ticket_type: data.group?.ticket_type ?? "Ingresso",
    recipient: null,
    quantity: tickets.length,
    price: 0,
    for_sale: false,
    art_path: null,
    art_url: data.group?.art_url,
    art_width: data.group?.art_width ?? null,
    art_height: data.group?.art_height ?? null,
    width_cm: data.group?.width_cm ?? null,
    height_cm: data.group?.height_cm ?? null,
    layout: data.group?.layout as Group["layout"],
  };

  const prepareWhatsApp = async (_chosenFormat: TicketFileFormat): Promise<WhatsAppFilePayload> => {
    if (!selectedForSharing.length) throw new Error("Selecione pelo menos um ingresso disponível.");
    if (selectedForSharing.length > 100)
      throw new Error("Selecione até 100 ingressos de cada vez.");
    const items = selectedForSharing.map((ticket) => ({
      group: fileGroup,
      ticket: { ...ticket, group_id: fileGroup.id } as TicketRow,
    }));
    const files = await createTicketFiles(items, data.event?.name ?? "Evento", "pdf");
    return {
      files,
      ticketIds: selectedForSharing.map((ticket) => ticket.id),
      message: `Olá${name.trim() ? ` ${name.trim()}` : ""}! Seguem ${files.length} ingresso(s) de ${data.event?.name ?? "este evento"}, atribuídos a ${data.share.partner_name}. Os ficheiros individuais seguem em anexo.`,
      contact: contact.includes("@") ? null : contact.trim() || null,
    };
  };

  const confirmWhatsApp = async (payload: WhatsAppFilePayload) => {
    await markSent({
      data: {
        token,
        ids: payload.ticketIds,
        via: "whatsapp",
        name,
        contact: payload.contact ?? "",
        confirmed: true,
      },
    });
    await qc.invalidateQueries({ queryKey: ["share", token] });
    setSel(new Set());
    toast.success(`${payload.ticketIds.length} ingresso(s) registados como enviados por WhatsApp.`);
  };

  const sendEmail = async () => {
    if (!selectedForSharing.length) return toast.error("Selecione ingressos ainda disponíveis.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim()))
      return toast.error("Indique um e-mail válido.");
    if (selectedForSharing.length > 50)
      return toast.error("Selecione até 50 ingressos por e-mail.");
    setBusy(true);
    try {
      const result = await sendSharedTicketEmail({
        data: {
          token,
          ticketIds: selectedForSharing.map((ticket) => ticket.id),
          recipient: contact.trim(),
          recipientName: name.trim(),
        },
      });
      if (result.status !== "sent") throw new Error("O servidor não confirmou o envio do e-mail.");
      await qc.invalidateQueries({ queryKey: ["share", token] });
      setSel(new Set());
      toast.success(`${result.count} ingresso(s) enviados por e-mail para ${result.recipient}.`);
    } catch (sendError) {
      toast.error((sendError as Error).message);
      await qc.invalidateQueries({ queryKey: ["share", token] });
    } finally {
      setBusy(false);
    }
  };

  const copyLinks = async () => {
    if (!selectedForSharing.length) return toast.error("Selecione ingressos ainda disponíveis.");
    if (selectedForSharing.length > 50)
      return toast.error("Selecione até 50 ingressos por mensagem.");
    setBusy(true);
    try {
      const link = holderLink(selectedForSharing.map((ticket) => ticket.share_token));
      await navigator.clipboard.writeText(
        `Olá! Seguem ${selectedForSharing.length} ingresso(s) de ${data.event?.name ?? "este evento"}:\n${link}`,
      );
      await markSent({
        data: {
          token,
          ids: selectedForSharing.map((ticket) => ticket.id),
          via: "link",
          name,
          contact,
        },
      });
      await qc.invalidateQueries({ queryKey: ["share", token] });
      setSel(new Set());
      toast.success("Link copiado. Pode enviá-lo ao destinatário.");
    } catch (copyError) {
      toast.error((copyError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadSelected = async () => {
    if (!selectedForSharing.length) return toast.error("Selecione ingressos ainda disponíveis.");
    if (selectedForSharing.length > 200)
      return toast.error("Descarregue até 200 ingressos de cada vez.");
    setBusy(true);
    try {
      const items = selectedForSharing.map((ticket) => ({
        group: fileGroup,
        ticket: { ...ticket, group_id: fileGroup.id } as TicketRow,
      }));
      const files = await createTicketFiles(items, data.event?.name ?? "Evento", "pdf");
      await downloadTicketFiles(files);
      await markSent({ data: { token, ids: selectedForSharing.map((ticket) => ticket.id), via: "download", name, contact } });
      await qc.invalidateQueries({ queryKey: ["share", token] });
      setSel(new Set());
      toast.success(
        `${files.length} PDF(s) descarregado(s) individualmente.`,
      );
    } catch (downloadError) {
      toast.error((downloadError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <Logo />
          <Badge variant="secondary">{data.share.partner_kind}</Badge>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6 pb-56">
        <div>
          <p className="text-sm text-muted-foreground">Portal de {data.share.partner_name}</p>
          <h1 className="text-3xl font-bold">{data.event?.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data.group?.name} · {data.group?.ticket_type}
            {data.event?.venue ? ` · ${data.event.venue}` : ""}
            {data.event?.event_date ? ` · ${data.event.event_date}` : ""}
          </p>
          {data.share.note && <p className="mt-2 text-sm">{data.share.note}</p>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            ["Atribuídos", stats.total],
            ["Enviados", stats.sent],
            ["Já entraram", stats.used],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["todo", "Por enviar"],
              ["sent", "Enviados"],
              ["used", "Entraram"],
              ["all", "Todos"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "secondary"}
              disabled={whatsAppLocked || busy}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Código ou nome…"
              className="pl-9"
              disabled={whatsAppLocked || busy}
            />
          </div>
        </div>

        <div className="rounded-2xl border bg-card divide-y">
          <label className="flex items-center gap-3 p-3 text-sm">
            <Checkbox
              checked={
                shown.length > 0 &&
                shown
                  .filter(
                    (ticket) => ticket.status === "valid" && !ticket.sent_at && !ticket.printed_at,
                  )
                  .every((ticket) => sel.has(ticket.id))
              }
              disabled={whatsAppLocked || busy}
              onCheckedChange={(value) =>
                setSel(
                  value
                    ? new Set(
                        shown
                          .filter(
                            (ticket) =>
                              ticket.status === "valid" && !ticket.sent_at && !ticket.printed_at,
                          )
                          .map((ticket) => ticket.id),
                      )
                    : new Set(),
                )
              }
            />
            Selecionar disponíveis (
            {
              shown.filter(
                (ticket) => ticket.status === "valid" && !ticket.sent_at && !ticket.printed_at,
              ).length
            }
            )<span className="ml-auto text-muted-foreground">Selecionar os primeiros</span>
            <Input
              type="number"
              min={1}
              max={
                shown.filter(
                  (ticket) => ticket.status === "valid" && !ticket.sent_at && !ticket.printed_at,
                ).length
              }
              placeholder="Qtd"
              className="h-8 w-20"
              disabled={whatsAppLocked || busy}
              onChange={(event) => {
                const n = parseInt(event.target.value) || 0;
                setSel(
                  new Set(
                    shown
                      .filter(
                        (ticket) =>
                          ticket.status === "valid" && !ticket.sent_at && !ticket.printed_at,
                      )
                      .slice(0, n)
                      .map((ticket) => ticket.id),
                  ),
                );
              }}
            />
          </label>
          {shown.map((ticket) => {
            const selectable =
              ticket.status === "valid" &&
              !ticket.sent_at &&
              !ticket.printed_at &&
              ticket.email_delivery_status !== "sending" &&
              ticket.email_delivery_status !== "sent";
            return (
              <label
                key={ticket.id}
                className="flex flex-wrap items-center gap-3 p-3 text-sm cursor-pointer"
              >
                <Checkbox
                  checked={sel.has(ticket.id)}
                  disabled={!selectable || whatsAppLocked || busy}
                  onCheckedChange={(value) => {
                    const next = new Set(sel);
                    if (value) next.add(ticket.id);
                    else next.delete(ticket.id);
                    setSel(next);
                  }}
                />
                <span className="text-muted-foreground w-10">#{ticket.seq}</span>
                <span className="font-mono">{ticket.code}</span>
                <span className="flex-1 truncate">
                  {ticket.holder_name}
                  {ticket.holder_contact ? ` · ${ticket.holder_contact}` : ""}
                </span>
                {ticket.status === "used" ? (
                  <Badge>Entrou</Badge>
                ) : ticket.sent_at ? (
                  <Badge variant="secondary">{VIA[ticket.sent_via ?? ""] ?? "Enviado"}</Badge>
                ) : (
                  <Badge variant="outline">Por enviar</Badge>
                )}
              </label>
            );
          })}
          {!shown.length && (
            <p className="p-6 text-center text-sm text-muted-foreground">Nada aqui.</p>
          )}
        </div>
      </main>

      <div className="fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do convidado (opcional)"
              disabled={whatsAppLocked || busy}
            />
            <Input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Telefone WhatsApp ou e-mail"
              disabled={whatsAppLocked || busy}
            />
          </div>
          <WhatsAppShareFlow
            title={`Ingressos — ${data.event?.name ?? "MY Tickets"}`}
            onPrepare={prepareWhatsApp}
            onConfirm={confirmWhatsApp}
            disabled={busy || !selectedForSharing.length}
            onLockChange={setWhatsAppLocked}
            formats={["pdf"]}
          />
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground mr-auto">
              {selectedForSharing.length} disponível(is) selecionado(s)
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || whatsAppLocked || !selectedForSharing.length}
              onClick={() => void sendEmail()}
            >
              <Mail className="h-4 w-4" /> E-mail
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || whatsAppLocked || !selectedForSharing.length}
              onClick={() => void copyLinks()}
            >
              <Copy className="h-4 w-4" /> Copiar link de download (opcional)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || whatsAppLocked || !selectedForSharing.length}
              onClick={() => void downloadSelected()}
            >
              <Download className="h-4 w-4" /> Baixar PDFs
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O PDF é o método principal. Como alternativa, o parceiro pode copiar um link que permite apenas descarregar os ingressos em PDF — sem acesso ao portal de gestão.
          </p>
        </div>
      </div>
    </div>
  );
}
