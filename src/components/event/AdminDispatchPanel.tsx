import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { WhatsAppShareFlow, type WhatsAppFilePayload } from "@/components/event/WhatsAppShareFlow";
import { ensureTickets, fetchAllTickets, type Group, type TicketRow } from "@/lib/generate";
import { createTicketFiles, downloadTicketFiles, type TicketFileFormat } from "@/lib/ticket-files";
import { artUrl } from "@/lib/generate";
import { holderLink, downloadPdf, type RenderGroup } from "@/lib/share-render";
import { sendTicketEmail } from "@/lib/order-email.functions";
import { releaseTicketsForRedistribution } from "@/lib/ticket-admin.functions";

const TICKET_COLUMNS =
  "id,code,seq,status,group_id,share_token,holder_name,printed_at,share_id,sent_at,email_delivery_status";

type DispatchTicket = TicketRow & { share_token?: string };

/** Direct dispatch with format choices and superadmin-only redistribution of marked tickets. */
export function AdminDispatchPanel({
  eventId,
  eventName,
  groups,
}: {
  eventId: string;
  eventName: string;
  groups: Group[];
}) {
  const qc = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [resendMarked, setResendMarked] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [format, setFormat] = useState<TicketFileFormat>("pdf");
  const [busy, setBusy] = useState(false);
  const [whatsAppLocked, setWhatsAppLocked] = useState(false);
  const { data: tickets = [] } = useQuery<DispatchTicket[]>({
    queryKey: ["admin-dispatch", eventId],
    queryFn: () =>
      fetchAllTickets({ event_id: eventId }, TICKET_COLUMNS) as Promise<DispatchTicket[]>,
  });

  const available = tickets.filter(
    (ticket) =>
      ticket.status === "valid" &&
      !ticket.printed_at &&
      !ticket.share_id &&
      !ticket.sent_at &&
      ticket.email_delivery_status !== "sent" &&
      ticket.email_delivery_status !== "sending",
  );
  const marked = tickets.filter(
    (ticket) =>
      ticket.status === "valid" &&
      (!!ticket.printed_at || !!ticket.sent_at || ticket.email_delivery_status === "sent"),
  );
  const redistributing = resendMarked && isSuperAdmin;
  const source = redistributing ? marked : available;
  const requested = groups.reduce((sum, group) => sum + Math.max(0, quantities[group.id] ?? 0), 0);
  const picked = groups.flatMap((group) =>
    source
      .filter((ticket) => ticket.group_id === group.id)
      .slice(0, Math.max(0, quantities[group.id] ?? 0)),
  );

  const refreshDispatch = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-dispatch", eventId] }),
      qc.invalidateQueries({ queryKey: ["share-tix", eventId] }),
      qc.invalidateQueries({ queryKey: ["tickets", eventId] }),
      qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
      qc.invalidateQueries({ queryKey: ["groups", eventId] }),
    ]);
  };

  const resolvePicked = async () => {
    const chosenGroups = groups.filter((group) => (quantities[group.id] ?? 0) > 0);
    if (!chosenGroups.length) throw new Error("Escolha a quantidade em pelo menos um grupo");

    // Normal dispatch creates any missing codes first. Redispatch deliberately selects only
    // already-marked tickets and uses the privileged release operation before reusing them.
    if (!redistributing) {
      for (const group of chosenGroups) await ensureTickets(group);
    }
    const rows = (await fetchAllTickets({ event_id: eventId }, TICKET_COLUMNS)) as DispatchTicket[];
    const eligible = redistributing
      ? rows.filter(
          (ticket) =>
            ticket.status === "valid" &&
            (!!ticket.printed_at || !!ticket.sent_at || ticket.email_delivery_status === "sent"),
        )
      : rows.filter(
          (ticket) =>
            ticket.status === "valid" &&
            !ticket.printed_at &&
            !ticket.share_id &&
            !ticket.sent_at &&
            ticket.email_delivery_status !== "sent" &&
            ticket.email_delivery_status !== "sending",
        );
    const selection = chosenGroups.flatMap((group) =>
      eligible.filter((ticket) => ticket.group_id === group.id).slice(0, quantities[group.id] ?? 0),
    );
    if (selection.length !== requested) {
      throw new Error(
        redistributing
          ? "Nem todos os ingressos marcados continuam disponíveis para redistribuição. Atualize a página."
          : "Não há ingressos livres em quantidade suficiente neste grupo. Reveja a quantidade selecionada.",
      );
    }
    if (redistributing && selection.length > 500)
      throw new Error("Selecione até 500 ingressos marcados por operação");
    qc.setQueryData(["admin-dispatch", eventId], rows);
    return selection;
  };

  const releaseForRedistribution = async (selection: DispatchTicket[]) => {
    if (!redistributing) return;
    await releaseTicketsForRedistribution({
      data: { eventId, ticketIds: selection.map((ticket) => ticket.id) },
    });
  };

  const prepareWhatsApp = async (chosenFormat: TicketFileFormat): Promise<WhatsAppFilePayload> => {
    const selection = await resolvePicked();
    if (selection.length > 100)
      throw new Error("Selecione até 100 ingressos de cada vez para partilhar pelo WhatsApp.");
    const items = selection.flatMap((ticket) => {
      const group = groups.find((item) => item.id === ticket.group_id);
      return group ? [{ group, ticket }] : [];
    });
    if (items.length !== selection.length)
      throw new Error("Não foi possível identificar o grupo de todos os ingressos.");
    const files = await createTicketFiles(items, eventName, chosenFormat);
    const recipient = name.trim() ? ` para ${name.trim()}` : "";
    return {
      files,
      ticketIds: selection.map((ticket) => ticket.id),
      message: `Olá${recipient}! Seguem ${selection.length} ingresso(s) para ${eventName}. Os ingressos individuais seguem em anexo.`,
      contact: contact.includes("@") ? null : contact.trim() || null,
    };
  };

  const confirmWhatsApp = async (payload: WhatsAppFilePayload) => {
    if (redistributing) {
      await releaseTicketsForRedistribution({ data: { eventId, ticketIds: payload.ticketIds } });
    }
    const sentAt = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from("tickets")
      .update({
        sent_via: "whatsapp",
        sent_at: sentAt,
        ...(payload.contact ? { holder_contact: payload.contact } : {}),
      })
      .in("id", payload.ticketIds)
      .eq("event_id", eventId)
      .eq("status", "valid")
      .is("printed_at", null)
      .is("share_id", null)
      .is("sent_at", null)
      .neq("email_delivery_status", "sending")
      .neq("email_delivery_status", "sent")
      .select("id");
    if (error) throw error;
    if ((updated ?? []).length !== payload.ticketIds.length) {
      throw new Error(
        "Alguns ingressos deixaram de estar disponíveis. Atualize a página antes de repetir o envio.",
      );
    }
    setQuantities({});
    await refreshDispatch();
    toast.success(`${payload.ticketIds.length} ingresso(s) registados como enviados por WhatsApp.`);
  };

  const send = async (via: "email" | "link" | "download" | "pdf") => {
    if (busy || whatsAppLocked) return;
    if (via === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return toast.error("Indique um e-mail válido");
    setBusy(true);
    try {
      const selection = await resolvePicked();
      if (via === "email" && selection.length > 100)
        throw new Error("Selecione até 100 ingressos por e-mail");
      if (via === "email") {
        await releaseForRedistribution(selection);
        const result = await sendTicketEmail({
          data: {
            eventId,
            ticketIds: selection.map((ticket) => ticket.id),
            recipient: email.trim(),
          },
        });
        if (result.status !== "sent") throw new Error("O Zoho não confirmou o envio");
        toast.success(
          `E-mail enviado a ${result.recipient}${result.cc.length ? ` · CC: ${result.cc.join(", ")}` : ""}`,
        );
      } else if (via === "link") {
        const tokens = selection
          .map((ticket) => ticket.share_token)
          .filter((token): token is string => !!token);
        if (tokens.length !== selection.length)
          throw new Error("Não foi possível preparar todos os links seguros");
        // The download endpoint accepts up to 50 tokens per link. Split larger
        // selections into multiple valid links so all selected tickets can be shared.
        const links = Array.from({ length: Math.ceil(tokens.length / 50) }, (_, index) =>
          holderLink(tokens.slice(index * 50, (index + 1) * 50)),
        );
        const message = `Olá${name.trim() ? ` ${name.trim()}` : ""}! Aqui estão ${selection.length} ingresso(s) para ${eventName}:\n\n${links.map((url, index) => `Grupo ${index + 1}: ${url}`).join("\n")}\n\nApresente o QR Code à entrada. Cada link permite descarregar até 50 ingressos.`;
        await navigator.clipboard.writeText(message);
        toast.success("Links de download copiados. A cópia não marca os ingressos como entregues.");
      } else if (via === "pdf") {
        const items = await Promise.all(
          selection.map(async (ticket) => {
            const group = groups.find((item) => item.id === ticket.group_id);
            if (!group) throw new Error("Não foi possível identificar um grupo de ingressos");
            return {
              g: { ...group, art_url: await artUrl(group.art_path ?? "") } as RenderGroup,
              code: ticket.code,
              holderName: group.ticket_type.toUpperCase().includes("MESA")
                ? ticket.holder_name
                : null,
            };
          }),
        );
        if (items.some((item) => !item.g.art_url)) throw new Error("Há grupos sem arte disponível");
        await downloadPdf(items, `${eventName}_ingressos`);
        await releaseForRedistribution(selection);
        const { error } = await supabase
          .from("tickets")
          .update({ sent_via: "download", sent_at: new Date().toISOString() })
          .in(
            "id",
            selection.map((ticket) => ticket.id),
          )
          .eq("event_id", eventId)
          .eq("status", "valid")
          .is("printed_at", null)
          .is("share_id", null)
          .is("sent_at", null);
        if (error) throw error;
        toast.success("PDF dos ingressos descarregado");
      } else {
        if (selection.length > 200)
          throw new Error(
            "Descarregue até 200 ingressos de cada vez para manter a preparação rápida.",
          );
        const items = selection.flatMap((ticket) => {
          const group = groups.find((item) => item.id === ticket.group_id);
          return group ? [{ group, ticket }] : [];
        });
        if (items.length !== selection.length)
          throw new Error("Não foi possível identificar o grupo de todos os ingressos.");
        const files = await createTicketFiles(items, eventName, format);
        await downloadTicketFiles(files);
        await releaseForRedistribution(selection);
        const { data: updated, error } = await supabase
          .from("tickets")
          .update({ sent_via: "download", sent_at: new Date().toISOString() })
          .in(
            "id",
            selection.map((ticket) => ticket.id),
          )
          .eq("event_id", eventId)
          .eq("status", "valid")
          .is("printed_at", null)
          .is("share_id", null)
          .is("sent_at", null)
          .select("id");
        if (error) throw error;
        if ((updated ?? []).length !== selection.length)
          throw new Error(
            "Os ficheiros foram descarregados, mas nem todos os ingressos puderam ser registados como distribuídos",
          );
        toast.success(
          `${files.length} ficheiro(s) ${format.toUpperCase()} descarregado(s) individualmente`,
        );
      }
      setQuantities({});
      await refreshDispatch();
    } catch (error) {
      await refreshDispatch();
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">Distribuição direta de ingressos</h3>
        <p className="text-sm text-muted-foreground">
          Escolha a quantidade por grupo. Os códigos em falta são criados automaticamente; ingressos
          impressos, atribuídos a parceiros ou já enviados não são reutilizados.
        </p>
      </div>
      {isSuperAdmin && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={resendMarked}
            disabled={busy || whatsAppLocked}
            onCheckedChange={(checked) => {
              setResendMarked(!!checked);
              setQuantities({});
            }}
          />
          Incluir ingressos já enviados ou impressos (apenas superadministrador)
        </label>
      )}
      {groups.map((group) => {
        const free = available.filter((ticket) => ticket.group_id === group.id).length;
        const markedCount = marked.filter((ticket) => ticket.group_id === group.id).length;
        const made = tickets.filter((ticket) => ticket.group_id === group.id).length;
        const toGenerate = Math.max(0, group.quantity - made);
        const capacity = redistributing ? markedCount : free + toGenerate;
        return (
          <label key={group.id} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {group.name} · {group.ticket_type}{" "}
              <span className="text-muted-foreground">
                {redistributing
                  ? `(${markedCount} marcados)`
                  : `(${free} livres${toGenerate ? ` · ${toGenerate} por gerar` : ""})`}
              </span>
            </span>
            <Input
              aria-label={`Quantidade de ${group.name}`}
              type="number"
              min={0}
              max={capacity}
              disabled={busy || whatsAppLocked}
              className="w-24"
              value={quantities[group.id] || ""}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [group.id]: Math.min(capacity, Math.max(0, Number(event.target.value) || 0)),
                }))
              }
            />
          </label>
        );
      })}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Nome do destinatário (opcional)"
          value={name}
          disabled={busy || whatsAppLocked}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          placeholder="WhatsApp do destinatário"
          value={contact}
          disabled={busy || whatsAppLocked}
          onChange={(event) => setContact(event.target.value)}
        />
        <Input
          type="email"
          placeholder="E-mail do destinatário"
          value={email}
          disabled={busy || whatsAppLocked}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <p className="text-sm font-medium">{requested} ingresso(s) selecionado(s)</p>
      <WhatsAppShareFlow
        title={`Ingressos — ${eventName}`}
        onPrepare={prepareWhatsApp}
        onConfirm={confirmWhatsApp}
        disabled={busy || requested === 0}
        onLockChange={setWhatsAppLocked}
        format={format}
        onFormatChange={setFormat}
      />
      <Button
        disabled={busy || whatsAppLocked || requested === 0}
        variant="secondary"
        onClick={() => void (async () => {
          try {
            const selection = await resolvePicked();
            const tokens = selection.map((ticket) => ticket.share_token).filter((token): token is string => !!token);
            if (tokens.length !== selection.length) throw new Error("Não foi possível preparar todos os links seguros");
            const links = Array.from({ length: Math.ceil(tokens.length / 50) }, (_, index) =>
              holderLink(tokens.slice(index * 50, (index + 1) * 50)),
            );
            const message = `Olá${name.trim() ? ` ${name.trim()}` : ""}! Aqui estão ${selection.length} ingresso(s) para ${eventName}:\n\n${links.map((url, index) => `Grupo ${index + 1}: ${url}`).join("\n")}\n\nAbra cada link para descarregar os seus ingressos.`;
            window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
          } catch (error) {
            toast.error((error as Error).message);
          }
        })()}
      >
        Preparar link para WhatsApp
      </Button>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || whatsAppLocked || requested === 0}
          variant="secondary"
          onClick={() => void send("email")}
        >
          E-mail
        </Button>
        <Button
          disabled={busy || whatsAppLocked || requested === 0}
          variant="secondary"
          onClick={() => void send("link")}
        >
          Copiar link
        </Button>
        <Button
          disabled={busy || whatsAppLocked || requested === 0}
          variant="secondary"
          onClick={() => void send("pdf")}
        >
          Baixar PDF reunido
        </Button>
        <Button
          disabled={busy || whatsAppLocked || requested === 0}
          variant="secondary"
          onClick={() => void send("download")}
        >
          {busy ? "A preparar…" : `Baixar ${format.toUpperCase()} individuais`}
        </Button>
      </div>
    </div>
  );
}
