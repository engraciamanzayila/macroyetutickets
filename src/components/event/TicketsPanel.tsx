import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, Download, Link2, Mail, MessageCircle, RotateCcw, Search } from "lucide-react";
import { artUrl } from "@/lib/generate";
import {
  assertSuperAdminTicketAccess,
  releaseTicketsForRedistribution,
} from "@/lib/ticket-admin.functions";
import { useAuth } from "@/lib/auth";
import { downloadPdf, type RenderGroup } from "@/lib/share-render";
import { supabase } from "@/integrations/supabase/client";
import type { Group, TicketRow } from "@/lib/generate";
import { createTicketFiles, downloadTicketFiles, type TicketFileFormat } from "@/lib/ticket-files";
import { sendTicketEmail } from "@/lib/order-email.functions";
import { holderLink } from "@/lib/share-render";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./StatusBadge";
import { WhatsAppShareFlow, type WhatsAppFilePayload } from "@/components/event/WhatsAppShareFlow";

const eligibleForDistribution = (ticket: TicketRow) =>
  ticket.status === "valid" &&
  !ticket.printed_at &&
  !ticket.share_id &&
  !ticket.sent_at &&
  ticket.email_delivery_status !== "sending" &&
  ticket.email_delivery_status !== "sent";

type TicketAdminRow = TicketRow & {
  share_token?: string | null;
  email_delivery_to?: string | null;
};

export function TicketsPanel({
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
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [contact, setContact] = useState("");
  const [format, setFormat] = useState<TicketFileFormat>("pdf");
  const [busy, setBusy] = useState(false);
  const [whatsAppLocked, setWhatsAppLocked] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tickets", eventId] }),
      qc.invalidateQueries({ queryKey: ["groups", eventId] }),
      qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
      qc.invalidateQueries({ queryKey: ["admin-dispatch", eventId] }),
    ]);
  };

  const voidMany = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase
        .from("tickets")
        .update({ status: "void" })
        .in("id", ids.slice(i, i + 200))
        .neq("status", "used");
      if (error) return toast.error(error.message);
    }
    toast.success(`${ids.length} ingresso(s) anulados (os que já entraram não são alterados).`);
    setPicked(new Set());
    await refresh();
  };

  const voidGroup = async () => {
    const selectedGroup = groups.find((item) => item.id === group);
    if (
      !selectedGroup ||
      !confirm(`Anular TODOS os ingressos por usar do grupo "${selectedGroup.name}"?`)
    )
      return;
    const { error } = await supabase
      .from("tickets")
      .update({ status: "void" })
      .eq("group_id", selectedGroup.id)
      .eq("status", "valid");
    if (error) return toast.error(error.message);
    toast.success("Grupo anulado.");
    await refresh();
  };

  const { data = [], isLoading } = useQuery<TicketAdminRow[]>({
    queryKey: ["tickets", eventId, q, group, status],
    queryFn: async () => {
      let query = supabase
        .from("tickets")
        .select(
          "id,code,seq,status,used_at,group_id,holder_name,share_token,printed_at,share_id,sent_at,email_delivery_status,email_delivery_to",
        )
        .eq("event_id", eventId)
        .order("seq")
        .limit(200);
      if (q) query = query.ilike("code", `%${q.trim().toUpperCase()}%`);
      if (group) query = query.eq("group_id", group);
      if (status) query = query.eq("status", status);
      return (await query).data ?? [];
    },
  });

  const groupName = (id: string) => groups.find((item) => item.id === id)?.name ?? "";
  const selectedForSharing = data.filter(
    (ticket) => picked.has(ticket.id) && eligibleForDistribution(ticket),
  );
  const releasable = data.filter(
    (ticket) =>
      picked.has(ticket.id) &&
      ticket.status === "valid" &&
      (!!ticket.printed_at || !!ticket.sent_at || ticket.email_delivery_status === "sent"),
  );
  const releaseSelected = async () => {
    if (!releasable.length) return;
    if (
      !confirm(
        `Libertar ${releasable.length} ingresso(s) para novo envio ou impressão? Os links anteriores poderão continuar válidos.`,
      )
    ) {
      return;
    }
    try {
      const { releasedCount } = await releaseTicketsForRedistribution({
        data: { eventId, ticketIds: releasable.map((ticket) => ticket.id) },
      });
      toast.success(`${releasedCount} ingresso(s) libertados para novo envio ou impressão.`);
      setPicked(new Set());
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const shareTicket = async (
    ticket: TicketAdminRow,
    via: "whatsapp" | "email" | "link" | "download",
  ) => {
    const alreadyDistributed =
      !!ticket.printed_at || !!ticket.sent_at || ticket.email_delivery_status === "sent";
    if (alreadyDistributed && !isSuperAdmin) {
      return toast.error(
        "Apenas o superadministrador pode reenviar ingressos já enviados ou impressos",
      );
    }

    let released = false;
    try {
      if (alreadyDistributed) await assertSuperAdminTicketAccess();
      const ticketGroup = groups.find((g) => g.id === ticket.group_id);
      if (!ticketGroup) throw new Error("Grupo não encontrado");
      if (!ticket.share_token) throw new Error("Este ingresso não tem um link seguro disponível");
      const ticketLink = holderLink([ticket.share_token]);
      const text = `Olá! Aqui está o seu ingresso para ${eventName}: ${ticketLink}\nApresente o QR code ou a referência à entrada.`;

      if (via === "link") {
        await navigator.clipboard.writeText(ticketLink);
        toast.success("Link do ingresso copiado");
        return;
      }

      if (via === "download") {
        const art = await artUrl(ticketGroup.art_path ?? "");
        if (!art) throw new Error("Este grupo ainda não tem arte disponível");
        const renderGroup: RenderGroup = {
          ...ticketGroup,
          art_url: art,
          layout: ticketGroup.layout,
        };
        await downloadPdf([{ g: renderGroup, code: ticket.code }], `${eventName}_${ticket.code}`);
        return;
      }

      const contact = window
        .prompt(
          via === "whatsapp" ? "Número do WhatsApp do destinatário:" : "E-mail do destinatário:",
          via === "email" ? (ticket.email_delivery_to ?? "") : "",
        )
        ?.trim();
      if (!contact) return;

      if (via === "whatsapp") {
        const digits = contact.replace(/\D/g, "");
        if (!digits) return toast.error("Indique um número de WhatsApp válido");
        const phone = digits.length === 9 ? `244${digits}` : digits;
        window.open(
          `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }

      if (!contact.includes("@")) return toast.error("Indique um e-mail válido");
      if (
        alreadyDistributed &&
        !confirm(`Este ingresso já está enviado ou impresso. Libertar e reenviar para ${contact}?`)
      ) {
        return;
      }
      if (alreadyDistributed) {
        await releaseTicketsForRedistribution({
          data: { eventId, ticketIds: [ticket.id] },
        });
        released = true;
      }
      const result = await sendTicketEmail({
        data: { eventId, ticketIds: [ticket.id], recipient: contact },
      });
      if (result.status !== "sent") throw new Error("O Zoho não confirmou o envio");
      toast.success(`E-mail enviado a ${result.recipient}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tickets", eventId] }),
        qc.invalidateQueries({ queryKey: ["admin-dispatch", eventId] }),
        qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
      ]);
    } catch (error) {
      if (released) {
        void Promise.all([
          qc.invalidateQueries({ queryKey: ["tickets", eventId] }),
          qc.invalidateQueries({ queryKey: ["admin-dispatch", eventId] }),
          qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
        ]);
      }
      toast.error((error as Error).message);
    }
  };

  const setTicket = async (id: string, patch: { status: string; used_at?: null }) => {
    const { error } = await supabase.from("tickets").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await refresh();
  };

  const prepareWhatsApp = async (chosenFormat: TicketFileFormat): Promise<WhatsAppFilePayload> => {
    if (!selectedForSharing.length)
      throw new Error("Selecione ingressos válidos ainda não distribuídos.");
    if (selectedForSharing.length > 100)
      throw new Error("Selecione até 100 ingressos de cada vez.");
    const items = selectedForSharing.flatMap((ticket) => {
      const ticketGroup = groups.find((item) => item.id === ticket.group_id);
      return ticketGroup ? [{ group: ticketGroup, ticket }] : [];
    });
    if (items.length !== selectedForSharing.length)
      throw new Error("Não foi possível identificar o grupo de todos os ingressos.");
    const files = await createTicketFiles(items, eventName, chosenFormat);
    return {
      files,
      ticketIds: selectedForSharing.map((ticket) => ticket.id),
      message: `Olá${contact.trim() && !contact.includes("@") ? ` ${contact.trim()}` : ""}! Seguem ${files.length} ingresso(s) para ${eventName}. Os ingressos individuais seguem em anexo.`,
      contact: contact.includes("@") ? null : contact.trim() || null,
    };
  };

  const confirmWhatsApp = async (payload: WhatsAppFilePayload) => {
    const { data: updated, error } = await supabase
      .from("tickets")
      .update({
        sent_via: "whatsapp",
        sent_at: new Date().toISOString(),
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
    if ((updated ?? []).length !== payload.ticketIds.length)
      throw new Error(
        "Um ou mais ingressos já não estão disponíveis; atualize a lista antes de confirmar.",
      );
    setPicked(new Set());
    await refresh();
    toast.success(`${payload.ticketIds.length} ingresso(s) registados como enviados por WhatsApp.`);
  };

  const sendEmail = async () => {
    if (!selectedForSharing.length)
      return toast.error("Selecione ingressos válidos ainda não distribuídos.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim()))
      return toast.error("Indique um e-mail válido.");
    setBusy(true);
    try {
      const result = await sendTicketEmail({
        data: {
          eventId,
          ticketIds: selectedForSharing.map((ticket) => ticket.id),
          recipient: contact.trim(),
        },
      });
      if (result.status !== "sent") throw new Error("O e-mail não foi confirmado pelo servidor.");
      setPicked(new Set());
      toast.success(`E-mail enviado a ${result.recipient}.`);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyLinks = async () => {
    if (!selectedForSharing.length)
      return toast.error("Selecione ingressos válidos ainda não distribuídos.");
    if (selectedForSharing.length > 50)
      return toast.error("Selecione até 50 ingressos por mensagem.");
    const tokens = selectedForSharing
      .map((ticket) => ticket.share_token)
      .filter((token): token is string => !!token);
    if (tokens.length !== selectedForSharing.length)
      return toast.error("Não foi possível preparar todos os links seguros.");
    setBusy(true);
    try {
      await navigator.clipboard.writeText(
        `Olá! Seguem ${tokens.length} ingresso(s) para ${eventName}:\n${holderLink(tokens)}`,
      );
      const { data: updated, error } = await supabase
        .from("tickets")
        .update({
          sent_via: "link",
          sent_at: new Date().toISOString(),
          holder_contact: contact.trim() || null,
        })
        .in(
          "id",
          selectedForSharing.map((ticket) => ticket.id),
        )
        .eq("event_id", eventId)
        .eq("status", "valid")
        .is("printed_at", null)
        .is("share_id", null)
        .is("sent_at", null)
        .select("id");
      if (error) throw error;
      if ((updated ?? []).length !== selectedForSharing.length)
        throw new Error("Nem todos os links puderam ser registados como enviados.");
      setPicked(new Set());
      toast.success("Links seguros copiados e ingressos registados como enviados.");
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadSelected = async () => {
    if (!selectedForSharing.length)
      return toast.error("Selecione ingressos válidos ainda não distribuídos.");
    if (selectedForSharing.length > 200)
      return toast.error("Descarregue até 200 ingressos de cada vez.");
    setBusy(true);
    try {
      const items = selectedForSharing.flatMap((ticket) => {
        const ticketGroup = groups.find((item) => item.id === ticket.group_id);
        return ticketGroup ? [{ group: ticketGroup, ticket }] : [];
      });
      const files = await createTicketFiles(items, eventName, format);
      await downloadTicketFiles(files);
      const { data: updated, error } = await supabase
        .from("tickets")
        .update({ sent_via: "download", sent_at: new Date().toISOString() })
        .in(
          "id",
          selectedForSharing.map((ticket) => ticket.id),
        )
        .eq("event_id", eventId)
        .eq("status", "valid")
        .is("printed_at", null)
        .is("share_id", null)
        .is("sent_at", null)
        .select("id");
      if (error) throw error;
      if ((updated ?? []).length !== selectedForSharing.length)
        throw new Error(
          "Os ficheiros foram preparados, mas nem todos os ingressos puderam ser registados.",
        );
      setPicked(new Set());
      toast.success(
        `${files.length} ficheiro(s) ${format.toUpperCase()} descarregado(s) individualmente.`,
      );
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Procurar código…"
            className="pl-9 font-mono"
          />
        </div>
        <select
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="" className="bg-popover">
            Todos os grupos
          </option>
          {groups.map((item) => (
            <option key={item.id} value={item.id} className="bg-popover">
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="" className="bg-popover">
            Todos os estados
          </option>
          <option value="valid" className="bg-popover">
            Por usar
          </option>
          <option value="used" className="bg-popover">
            Entrou
          </option>
          <option value="void" className="bg-popover">
            Anulado
          </option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={
              data.length > 0 &&
              data.filter(eligibleForDistribution).every((ticket) => picked.has(ticket.id))
            }
            disabled={whatsAppLocked || busy}
            onCheckedChange={(value) =>
              setPicked(
                value
                  ? new Set(data.filter(eligibleForDistribution).map((ticket) => ticket.id))
                  : new Set(),
              )
            }
          />
          Selecionar todos os disponíveis visíveis
        </label>
        <Button
          size="sm"
          variant="destructive"
          disabled={!picked.size || busy || whatsAppLocked}
          onClick={() => confirm(`Anular ${picked.size} ingresso(s)?`) && voidMany([...picked])}
        >
          <Ban className="h-4 w-4" /> Anular selecionados ({picked.size})
        </Button>
        {isSuperAdmin && (
          <Button
            size="sm"
            variant="outline"
            disabled={!releasable.length || busy || whatsAppLocked}
            onClick={() => void releaseSelected()}
          >
            <RotateCcw className="h-4 w-4" /> Libertar enviados/impressos ({releasable.length})
          </Button>
        )}
        {group && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={busy || whatsAppLocked}
            onClick={voidGroup}
          >
            <Ban className="h-4 w-4" /> Anular grupo inteiro
          </Button>
        )}
      </div>
      <div className="rounded-2xl border bg-card divide-y">
        {isLoading ? (
          <p className="p-6 text-muted-foreground">A carregar…</p>
        ) : data.length === 0 ? (
          <p className="p-6 text-muted-foreground">
            Nenhum ingresso. Gere ingressos no separador “Grupos”.
          </p>
        ) : (
          data.map((ticket) => (
            <div key={ticket.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Checkbox
                aria-label={`Selecionar ${ticket.code}`}
                disabled={ticket.status === "used" || busy || whatsAppLocked}
                checked={picked.has(ticket.id)}
                onCheckedChange={(value) =>
                  setPicked((previous) => {
                    const next = new Set(previous);
                    if (value) next.add(ticket.id);
                    else next.delete(ticket.id);
                    return next;
                  })
                }
              />
              <span className="font-mono font-bold w-44">{ticket.code}</span>
              <span className="text-sm text-muted-foreground flex-1 truncate">
                #{ticket.seq} · {groupName(ticket.group_id)}
              </span>
              {ticket.holder_name && (
                <span className="text-sm text-muted-foreground truncate">{ticket.holder_name}</span>
              )}
              {ticket.used_at && (
                <span className="text-xs text-muted-foreground">
                  {new Date(ticket.used_at).toLocaleString("pt-PT")}
                </span>
              )}
              {ticket.printed_at && <span className="text-xs text-muted-foreground">Impresso</span>}
              {(ticket.sent_at || ticket.email_delivery_status === "sent") && (
                <span className="text-xs text-muted-foreground">Enviado</span>
              )}
              <StatusBadge status={ticket.status} />
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  title="WhatsApp"
                  disabled={
                    (!!ticket.printed_at ||
                      !!ticket.sent_at ||
                      ticket.email_delivery_status === "sent") &&
                    !isSuperAdmin
                  }
                  onClick={() => void shareTicket(ticket, "whatsapp")}
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="E-mail"
                  disabled={
                    (!!ticket.printed_at ||
                      !!ticket.sent_at ||
                      ticket.email_delivery_status === "sent") &&
                    !isSuperAdmin
                  }
                  onClick={() => void shareTicket(ticket, "email")}
                >
                  <Mail className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Copiar link"
                  disabled={
                    (!!ticket.printed_at ||
                      !!ticket.sent_at ||
                      ticket.email_delivery_status === "sent") &&
                    !isSuperAdmin
                  }
                  onClick={() => void shareTicket(ticket, "link")}
                >
                  <Link2 className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Baixar PDF"
                  disabled={
                    (!!ticket.printed_at ||
                      !!ticket.sent_at ||
                      ticket.email_delivery_status === "sent") &&
                    !isSuperAdmin
                  }
                  onClick={() => void shareTicket(ticket, "download")}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
              {ticket.status === "void" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || whatsAppLocked}
                  onClick={() => setTicket(ticket.id, { status: "valid" })}
                >
                  <RotateCcw className="h-4 w-4" /> Reativar
                </Button>
              ) : (
                <>
                  {ticket.status === "used" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || whatsAppLocked}
                      onClick={() => setTicket(ticket.id, { status: "valid", used_at: null })}
                    >
                      <RotateCcw className="h-4 w-4" /> Repor
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy || whatsAppLocked}
                    onClick={() =>
                      confirm(`Anular ${ticket.code}?`) && setTicket(ticket.id, { status: "void" })
                    }
                  >
                    <Ban className="h-4 w-4" /> Anular
                  </Button>
                </>
              )}
            </div>
          ))
        )}
      </div>
      {data.length === 200 && (
        <p className="text-xs text-muted-foreground">
          A mostrar os primeiros 200. Use a pesquisa para filtrar.
        </p>
      )}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={contact}
            disabled={busy || whatsAppLocked}
            onChange={(event) => setContact(event.target.value)}
            placeholder="Telefone WhatsApp ou e-mail do destinatário"
          />
          <span className="self-center text-sm text-muted-foreground">
            {selectedForSharing.length} ingresso(s) disponíveis selecionados
          </span>
        </div>
        <WhatsAppShareFlow
          title={`Ingressos — ${eventName}`}
          onPrepare={prepareWhatsApp}
          onConfirm={confirmWhatsApp}
          disabled={busy || !selectedForSharing.length}
          onLockChange={setWhatsAppLocked}
          format={format}
          onFormatChange={setFormat}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || whatsAppLocked || !selectedForSharing.length}
            onClick={() => void sendEmail()}
          >
            <Mail className="h-4 w-4" /> Enviar por e-mail
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || whatsAppLocked || !selectedForSharing.length}
            onClick={() => void copyLinks()}
          >
            <Link2 className="h-4 w-4" /> Copiar links
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || whatsAppLocked || !selectedForSharing.length}
            onClick={() => void downloadSelected()}
          >
            <Download className="h-4 w-4" /> Baixar {format.toUpperCase()} individuais
          </Button>
        </div>
      </div>
    </div>
  );
}
