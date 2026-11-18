import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Mail, Search } from "lucide-react";
import { getShare, markSent } from "@/lib/shares.functions";
import { sendSharedTicketEmail } from "@/lib/order-email.functions";
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
    if (selectedForSharing.length > 100)
      return toast.error("Selecione até 100 ingressos por e-mail.");
    setBusy(true);
    try {
      const result = await sendSharedTicketEmail({
        data: {
          token,
          ticketIds: selectedForSharing.map((ticket) => ticket.id),
          recipient: contact.trim(),
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
        `${files.length} ficheiro(s) ${format.toUpperCase()} descarregado(s) individualmente.`,
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
              size="sm"
              variant="secondary"
              disabled={busy || whatsAppLocked || !selectedForSharing.length}
              onClick={() => void downloadSelected()}
            >
              <Download className="h-4 w-4" /> Baixar PDFs
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O destinatário recebe apenas os ficheiros PDF. Nenhum link de consulta ou acesso ao portal é enviado.
          </p>
        </div>
      </div>
    </div>
  );
}
