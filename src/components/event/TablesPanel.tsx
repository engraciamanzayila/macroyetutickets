import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Link2, Mail, MessageCircle, Printer, Search, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureTickets,
  fetchAllTickets,
  type Group,
  type TicketRow,
} from "@/lib/generate";
import { exportForPrint } from "@/lib/print";
import { holderLink } from "@/lib/share-render";
import { sendTicketEmail } from "@/lib/order-email.functions";
import { DEFAULT_LAYOUT, renderTicket } from "@/lib/render";
import { loadArt } from "@/lib/generate";
import {
  createTicketFiles,
  downloadFile,
  downloadTicketFiles,
  ticketFilesZip,
  type TicketFileFormat,
} from "@/lib/ticket-files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

export function TablesPanel({
  eventId,
  eventName,
  groups,
}: {
  eventId: string;
  eventName: string;
  groups: Group[];
}) {
  const qc = useQueryClient();
  const tableGroups = useMemo(
    () => groups.filter((group) => group.ticket_type.toUpperCase().includes("MESA")),
    [groups],
  );
  const [groupId, setGroupId] = useState(tableGroups[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [contact, setContact] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<"digital" | "print" | null>(null);
  const [sharing, setSharing] = useState<"whatsapp" | "email" | "link" | "native" | "fallback" | null>(null);
  const [fileFormat, setFileFormat] = useState<TicketFileFormat>("pdf");
  const [preparedWhatsApp, setPreparedWhatsApp] = useState<{
    files: File[];
    ids: string[];
    message: string;
    nativeAvailable: boolean;
  } | null>(null);
  const [pendingWhatsAppIds, setPendingWhatsAppIds] = useState<string[] | null>(null);
  const [pendingWhatsAppContact, setPendingWhatsAppContact] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"digital" | "print" | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const group = tableGroups.find((item) => item.id === groupId) ?? tableGroups[0];

  useEffect(() => {
    if (!tableGroups.some((item) => item.id === groupId)) setGroupId(tableGroups[0]?.id ?? "");
  }, [groupId, tableGroups]);

  const {
    data: tickets = [],
    isLoading,
    error: ticketsError,
  } = useQuery({
    queryKey: ["table-tickets", eventId, tableGroups.map((item) => item.id)],
    queryFn: async () => {
      const groupsTickets = await Promise.all(
        tableGroups.map(async (item) => ({
          groupId: item.id,
          tickets: await fetchAllTickets({ group_id: item.id }, "id,code,seq,status,group_id,used_at,printed_at,holder_name,share_id,share_token,sent_at,email_delivery_status"),
        })),
      );
      return groupsTickets.flatMap(({ groupId: id, tickets: rows }) =>
        rows.map((ticket) => ({ ...ticket, group_id: id })),
      );
    },
  });

  const currentTickets = useMemo(
    () => tickets.filter((ticket) => ticket.group_id === group?.id),
    [tickets, group?.id],
  );
  const visible = currentTickets.filter((ticket) =>
    `${ticket.code} ${ticket.holder_name ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const named = currentTickets.filter((ticket) => ticket.holder_name?.trim()).length;
  const availableTickets = currentTickets.filter(
    (ticket) =>
      ticket.status === "valid" &&
      !ticket.printed_at &&
      !ticket.share_id &&
      !ticket.sent_at &&
      ticket.email_delivery_status !== "sending" &&
      ticket.email_delivery_status !== "sent",
  );
  const selectedTickets = tickets.filter(
    (ticket) =>
      selectedIds.has(ticket.id) &&
      ticket.status === "valid" &&
      !ticket.printed_at &&
      !ticket.share_id &&
      !ticket.sent_at &&
      ticket.email_delivery_status !== "sending" &&
      ticket.email_delivery_status !== "sent",
  );
  const previewTicket = selectedTickets[previewIndex];
  const previewGroup = tableGroups.find((item) => item.id === previewTicket?.group_id);
  const previewName = previewTicket
    ? (names[previewTicket.id] ?? previewTicket.holder_name ?? "")
    : "";

  useEffect(() => {
    if (!previewMode || !previewGroup?.art_path || !previewTicket) {
      setPreviewImage("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    loadArt(previewGroup.art_path)
      .then(async (art) => {
        try {
          const canvas = await renderTicket(
            art,
            previewGroup.layout ?? DEFAULT_LAYOUT,
            previewTicket.code,
            previewName,
          );
          if (!cancelled) setPreviewImage(canvas.toDataURL("image/png"));
        } finally {
          art.close();
        }
      })
      .catch((error) => {
        if (!cancelled)
          toast.error("Não foi possível pré-visualizar o ingresso: " + (error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewGroup, previewMode, previewName, previewTicket]);

  const saveName = async (ticket: TicketRow, value: string) => {
    const name = value.trim();
    const original = ticket.holder_name ?? "";
    if (name === original) return;
    const { error } = await supabase
      .from("tickets")
      .update({ holder_name: name || null })
      .eq("id", ticket.id)
      .eq("event_id", eventId);
    if (error) return toast.error(`Não foi possível guardar o nome: ${error.message}`);
    setNames((current) => ({ ...current, [ticket.id]: name }));
    toast.success(`Nome guardado para ${ticket.code}`);
    qc.invalidateQueries({ queryKey: ["table-tickets", eventId] });
    qc.invalidateQueries({ queryKey: ["report", eventId] });
  };

  const generateMissing = async () => {
    if (!group || generating) return;
    setGenerating(true);
    try {
      await ensureTickets(group);
      await qc.invalidateQueries({ queryKey: ["table-tickets", eventId] });
      qc.invalidateQueries({ queryKey: ["tickets", eventId] });
      qc.invalidateQueries({ queryKey: ["groups", eventId] });
      qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] });
      toast.success("Códigos das mesas atualizados. Cada uma pode agora receber o seu titular.");
    } catch (error) {
      toast.error("Não foi possível gerar os códigos: " + (error as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const persistPendingNames = async () => {
    const changed = selectedTickets.filter((ticket) => {
      const currentName = names[ticket.id];
      return currentName !== undefined && currentName.trim() !== (ticket.holder_name ?? "");
    });
    for (const ticket of changed) {
      const { error } = await supabase
        .from("tickets")
        .update({ holder_name: names[ticket.id].trim() || null })
        .eq("id", ticket.id)
        .eq("event_id", eventId);
      if (error)
        throw new Error(`Não foi possível guardar o nome de ${ticket.code}: ${error.message}`);
    }
  };

  const validateExport = () => {
    if (!selectedTickets.length) {
      toast.error(
        "Selecione pelo menos uma mesa disponível. A seleção mantém-se ao trocar de grupo.",
      );
      return false;
    }
    const noLayout = new Set(
      selectedTickets
        .map((ticket) => tableGroups.find((item) => item.id === ticket.group_id))
        .filter((item) => !item?.layout || !item.art_path)
        .map((item) => item?.name ?? "Grupo sem arte"),
    );
    if (noLayout.size) {
      toast.error(`Configure QR e arte primeiro em: ${[...noLayout].join(", ")}`);
      return false;
    }
    const unnamed = selectedTickets.filter(
      (ticket) => !(names[ticket.id] ?? ticket.holder_name ?? "").trim(),
    );
    if (unnamed.length) {
      toast.error(`Preencha o nome de cada mesa a exportar. Faltam ${unnamed.length} titular(es).`);
      return false;
    }
    return true;
  };

  const requestExport = (mode: "digital" | "print") => {
    if (!validateExport() || exporting || generating) return;
    setPreviewIndex(0);
    setPreviewMode(mode);
  };

  const exportDigital = async () => {
    if (!group || exporting || preparedWhatsApp || pendingWhatsAppIds) return;
    setExporting("digital");
    try {
      await persistPendingNames();
      const ids = selectedTickets.map((ticket) => ticket.id);
      const items = selectedTickets.flatMap((ticket) => {
        const ticketGroup = tableGroups.find((item) => item.id === ticket.group_id);
        return ticketGroup
          ? [{ group: ticketGroup, ticket: { ...ticket, holder_name: names[ticket.id] ?? ticket.holder_name } }]
          : [];
      });
      const files = await createTicketFiles(items, eventName, fileFormat);
      if (!files.length) throw new Error("Não há ingressos digitais disponíveis para exportar");
      await downloadTicketFiles(files, `${eventName}_mesas_digitais`);
      const sentAt = new Date().toISOString();
      const { data: updated, error } = await supabase.from("tickets")
        .update({ sent_via: "download", sent_at: sentAt })
        .in("id", ids).eq("event_id", eventId).eq("status", "valid")
        .is("printed_at", null).is("share_id", null).is("sent_at", null)
        .neq("email_delivery_status", "sending").neq("email_delivery_status", "sent")
        .select("id");
      if (error) throw error;
      if ((updated ?? []).length !== ids.length) {
        throw new Error("Os ficheiros foram gerados, mas nem todas as mesas puderam ser registadas como distribuídas. Atualize a página e confirme o estado.");
      }
      toast.success(`${files.length} mesa(s) exportada(s) em ${fileFormat.toUpperCase()}, com ficheiros identificados por referência e titular.`);
      setSelectedIds(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["table-tickets", eventId] }),
        qc.invalidateQueries({ queryKey: ["groups", eventId] }),
        qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
        qc.invalidateQueries({ queryKey: ["tickets", eventId] }),
      ]);
    } catch (error) {
      toast.error("Falha ao gerar os ficheiros digitais: " + (error as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const exportPrint = async () => {
    if (!group || exporting) return;
    setExporting("print");
    try {
      await persistPendingNames();
      const picks = tableGroups.flatMap((item) => {
        const count = selectedTickets.filter((ticket) => ticket.group_id === item.id).length;
        return count ? [{ g: item, count }] : [];
      });
      const result = await exportForPrint(
        picks,
        `${eventName}_mesas`,
        () => {},
        eventId,
        undefined,
        new Set(selectedTickets.map((ticket) => ticket.id)),
      );
      toast.success(
        `${result.total} mesa(s) em ${result.pages} folha(s) A4, com nome, QR e referência.`,
      );
      setSelectedIds(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["table-tickets", eventId] }),
        qc.invalidateQueries({ queryKey: ["print-history", eventId] }),
        qc.invalidateQueries({ queryKey: ["report", eventId] }),
        qc.invalidateQueries({ queryKey: ["groups", eventId] }),
        qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
      ]);
    } catch (error) {
      toast.error("Falha ao exportar para impressão: " + (error as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const shareSelected = async (via: "email" | "link") => {
    if (!selectedTickets.length || sharing || preparedWhatsApp || pendingWhatsAppIds) return;
    if (selectedTickets.some((ticket) => !(names[ticket.id] ?? ticket.holder_name ?? "").trim())) {
      return toast.error("Preencha e guarde o nome de cada mesa antes de partilhar.");
    }
    if (via === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim())) {
      return toast.error("Indique um e-mail válido.");
    }
    if (via === "email" && selectedTickets.length > 100) return toast.error("Selecione até 100 mesas por e-mail.");
    if (via === "link" && selectedTickets.length > 50) return toast.error("Selecione até 50 mesas por link.");
    setSharing(via);
    const ids = selectedTickets.map((ticket) => ticket.id);
    try {
      await persistPendingNames();
      if (via === "email") {
        const result = await sendTicketEmail({ data: { eventId, ticketIds: ids, recipient: contact.trim() } });
        if (result.status !== "sent") throw new Error("O Zoho não confirmou o envio");
        const { error } = await supabase.from("tickets").update({ holder_contact: contact.trim() }).in("id", ids).eq("event_id", eventId);
        if (error) throw new Error(`E-mail enviado, mas não foi possível guardar o contacto: ${error.message}`);
        toast.success(`Mesas enviadas por e-mail para ${result.recipient}.`);
      } else {
        const tokens = selectedTickets.flatMap((ticket) => ticket.share_token ? [ticket.share_token] : []);
        if (tokens.length !== ids.length) throw new Error("Não foi possível preparar o link de todas as mesas.");
        const link = holderLink(tokens);
        const tableNames = selectedTickets.map((ticket) => `${(names[ticket.id] ?? ticket.holder_name ?? "").trim()} — Mesa #${ticket.seq}`).join("\n");
        const message = `Olá! Aqui estão ${selectedTickets.length} mesa(s) para ${eventName}:\n${tableNames}\n\nAbra os ingressos aqui: ${link}`;
        await navigator.clipboard.writeText(message);

        const sentAt = new Date().toISOString();
        const { data: updated, error } = await supabase.from("tickets")
          .update({ sent_via: "link", sent_at: sentAt })
          .in("id", ids).eq("event_id", eventId).eq("status", "valid")
          .is("printed_at", null).is("share_id", null).is("sent_at", null)
          .neq("email_delivery_status", "sending").neq("email_delivery_status", "sent")
          .select("id");
        if (error) throw error;
        if ((updated ?? []).length !== ids.length) {
          throw new Error("Nem todas as mesas puderam ser registadas como distribuídas. Atualize e confirme o estado.");
        }
        toast.success("Mensagem com os links copiada e mesas registadas como distribuídas.");
      }
      setSelectedIds(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["table-tickets", eventId] }),
        qc.invalidateQueries({ queryKey: ["groups", eventId] }),
        qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
        qc.invalidateQueries({ queryKey: ["tickets", eventId] }),
      ]);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSharing(null);
    }
  };

  const prepareWhatsAppFiles = async () => {
    if (!selectedTickets.length || sharing || preparedWhatsApp || pendingWhatsAppIds) return;
    if (selectedTickets.length > 100) return toast.error("Selecione até 100 mesas de cada vez para preparar os ficheiros.");
    if (selectedTickets.some((ticket) => !(names[ticket.id] ?? ticket.holder_name ?? "").trim())) {
      return toast.error("Preencha e guarde o nome de cada mesa antes de preparar os ficheiros.");
    }
    setSharing("whatsapp");
    try {
      await persistPendingNames();
      const items = selectedTickets.flatMap((ticket) => {
        const ticketGroup = tableGroups.find((item) => item.id === ticket.group_id);
        return ticketGroup
          ? [{ group: ticketGroup, ticket: { ...ticket, holder_name: names[ticket.id] ?? ticket.holder_name } }]
          : [];
      });
      const individualFiles = await createTicketFiles(items, eventName, fileFormat);
      const shareFiles = individualFiles.length > 10
        ? [await ticketFilesZip(individualFiles, `${eventName}_mesas`)]
        : individualFiles;
      const ids = selectedTickets.map((ticket) => ticket.id);
      const tokens = selectedTickets.flatMap((ticket) => ticket.share_token ? [ticket.share_token] : []);
      if (tokens.length !== ids.length) throw new Error("Não foi possível preparar os links seguros de todas as mesas.");
      const tableNames = selectedTickets
        .map((ticket) => `${(names[ticket.id] ?? ticket.holder_name ?? "").trim()} — Mesa #${ticket.seq}`)
        .join("\n");
      const message = `Olá! Seguem ${selectedTickets.length} mesa(s) para ${eventName}:\n${tableNames}\n\nLinks seguros: ${holderLink(tokens)}`;
      const shareData = { files: shareFiles };
      const nativeAvailable = typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" && navigator.canShare(shareData);
      setPreparedWhatsApp({ files: shareFiles, ids, message, nativeAvailable });
      toast.success(nativeAvailable
        ? "Ficheiros prontos. Carregue em Partilhar e escolha WhatsApp no menu do dispositivo."
        : "Ficheiros prontos. Este navegador não permite anexá-los diretamente; descarregue-os e anexe-os no WhatsApp.");
    } catch (error) {
      toast.error("Não foi possível preparar os ficheiros: " + (error as Error).message);
    } finally {
      setSharing(null);
    }
  };

  const sharePreparedWhatsApp = async () => {
    if (!preparedWhatsApp?.nativeAvailable || sharing) return;
    setSharing("native");
    try {
      await navigator.share({
        title: `Mesas — ${eventName}`,
        text: preparedWhatsApp.message,
        files: preparedWhatsApp.files,
      });
      setPendingWhatsAppIds(preparedWhatsApp.ids);
      setPendingWhatsAppContact(null);
      setPreparedWhatsApp(null);
      toast.success("Partilha concluída pelo menu do dispositivo. Confirme abaixo depois de enviar pelo WhatsApp.");
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") {
        toast.error("A partilha foi recusada pelo dispositivo: " + (error as Error).message);
      }
    } finally {
      setSharing(null);
    }
  };

  const fallbackWhatsApp = async () => {
    if (!preparedWhatsApp || sharing) return;
    const digits = contact.replace(/\D/g, "");
    if (digits.length < 9) return toast.error("Indique um número de WhatsApp com indicativo do país.");
    const whatsAppTab = window.open("about:blank", "_blank");
    if (!whatsAppTab) return toast.error("Permita pop-ups para abrir o WhatsApp.");
    whatsAppTab.opener = null;
    setSharing("fallback");
    try {
      const file = preparedWhatsApp.files.length === 1
        ? preparedWhatsApp.files[0]
        : await ticketFilesZip(preparedWhatsApp.files, `${eventName}_mesas`);
      downloadFile(file);
      const phone = digits.length === 9 ? `244${digits}` : digits;
      whatsAppTab.location.href = `https://wa.me/${phone}?text=${encodeURIComponent(preparedWhatsApp.message)}`;
      setPendingWhatsAppIds(preparedWhatsApp.ids);
      setPendingWhatsAppContact(contact.trim() || null);
      setPreparedWhatsApp(null);
      toast.info("Anexe no WhatsApp o ficheiro acabado de descarregar. Depois, confirme o envio nesta página.");
    } catch (error) {
      whatsAppTab.close();
      toast.error("Não foi possível preparar o anexo: " + (error as Error).message);
    } finally {
      setSharing(null);
    }
  };

  const confirmWhatsAppSent = async () => {
    if (!pendingWhatsAppIds?.length || sharing) return;
    setSharing("whatsapp");
    const sentAt = new Date().toISOString();
    try {
      const { data: updated, error } = await supabase.from("tickets")
        .update({
          sent_via: "whatsapp",
          sent_at: sentAt,
          ...(pendingWhatsAppContact ? { holder_contact: pendingWhatsAppContact } : {}),
        })
        .in("id", pendingWhatsAppIds).eq("event_id", eventId).eq("status", "valid")
        .is("printed_at", null).is("share_id", null).is("sent_at", null)
        .neq("email_delivery_status", "sending").neq("email_delivery_status", "sent")
        .select("id");
      if (error) throw error;
      if ((updated ?? []).length !== pendingWhatsAppIds.length) {
        throw new Error("Nem todas as mesas foram registadas. Atualize a página e confirme o estado.");
      }
      setPendingWhatsAppIds(null);
      setPendingWhatsAppContact(null);
      setSelectedIds(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["table-tickets", eventId] }),
        qc.invalidateQueries({ queryKey: ["groups", eventId] }),
        qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }),
        qc.invalidateQueries({ queryKey: ["tickets", eventId] }),
      ]);
      toast.success("Mesas registadas como enviadas por WhatsApp.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSharing(null);
    }
  };

  const pickContact = async (field: "tel" | "email") => {
    type ContactRecord = { tel?: string[]; email?: string[]; name?: string[] };
    type ContactPicker = { select: (properties: string[], options: { multiple: boolean }) => Promise<ContactRecord[]> };
    const contacts = (navigator as Navigator & { contacts?: ContactPicker }).contacts;
    if (!contacts) {
      toast.info("Este navegador não disponibiliza a agenda. Escreva o número ou e-mail manualmente.");
      return;
    }
    try {
      const results = await contacts.select(["name", field], { multiple: false });
      const value = results[0]?.[field]?.[0];
      if (value) {
        setContact(value);
        toast.success(`Contacto selecionado${results[0]?.name?.[0] ? `: ${results[0].name[0]}` : ""}.`);
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error("Não foi possível abrir a agenda deste dispositivo.");
    }
  };

  const confirmExport = async () => {
    const mode = previewMode;
    setPreviewMode(null);
    if (mode === "digital") await exportDigital();
    if (mode === "print") await exportPrint();
  };

  if (!tableGroups.length)
    return (
      <p className="text-sm text-muted-foreground">
        Este evento ainda não tem grupos do tipo Mesa.
      </p>
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Gestão de mesas</h2>
          <p className="text-sm text-muted-foreground">
            Cada código representa uma mesa e recebe o nome do respetivo cliente, independentemente
            do preço ou da quantidade do grupo.
          </p>
        </div>
        <select
          aria-label="Grupo de mesas"
          value={group?.id ?? ""}
          onChange={(event) => setGroupId(event.target.value)}
          className="h-10 min-w-56 rounded-md border border-input bg-background px-3 text-sm"
        >
          {tableGroups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.price ? `${item.price.toLocaleString("pt-AO")} Kz · ` : ""}
              {item.quantity} mesas
            </option>
          ))}
        </select>
      </header>

      {group && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{currentTickets.length} códigos criados</Badge>
              <Badge variant="outline">{availableTickets.length} disponíveis</Badge>
              <Badge variant="outline">{named} com titular</Badge>
              <Badge variant="outline">
                {Math.max(0, group.quantity - currentTickets.length)} por gerar
              </Badge>
              <Badge variant="outline">
                {selectedTickets.length} selecionada(s) em todos os grupos
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {currentTickets.length < group.quantity && (
                <Button onClick={generateMissing} disabled={generating || !!exporting}>
                  {generating ? "A gerar…" : "Gerar códigos em falta"}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => requestExport("digital")}
                disabled={!!exporting || generating || !!preparedWhatsApp || !!pendingWhatsAppIds || selectedTickets.length === 0}
              >
                <Download className="h-4 w-4" />
                {exporting === "digital"
                  ? "A gerar digitais…"
                  : `Baixar digitais (${selectedTickets.length})`}
              </Button>
              <Button
                onClick={() => requestExport("print")}
                disabled={!!exporting || generating || !!preparedWhatsApp || !!pendingWhatsAppIds || selectedTickets.length === 0}
              >
                <Printer className="h-4 w-4" />
                {exporting === "print" ? "A paginar…" : `Imprimir A4 (${selectedTickets.length})`}
              </Button>
            </div>
          </div>

          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Formato dos ficheiros digitais</span>
            <select
              value={fileFormat}
              disabled={!!preparedWhatsApp || !!pendingWhatsAppIds}
              onChange={(event) => {
                setFileFormat(event.target.value as TicketFileFormat);
                setPreparedWhatsApp(null);
              }}
              className="h-9 rounded-md border border-input bg-background px-3"
              aria-label="Formato dos ficheiros digitais das mesas"
            >
              <option value="pdf">PDF</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="tiff">TIFF</option>
            </select>
            <span className="text-xs text-muted-foreground">Cada ficheiro inclui evento, grupo, número, referência e titular no nome.</span>
          </label>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Partilhar mesas selecionadas</p>
              <p className="text-xs text-muted-foreground">O WhatsApp recebe o ficheiro pelo menu de partilha do dispositivo, quando disponível. Em navegadores sem suporte, descarregue e anexe manualmente.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input disabled={!!pendingWhatsAppIds} value={contact} onChange={(event) => setContact(event.target.value)} placeholder="E-mail ou número de WhatsApp (com indicativo)" aria-label="E-mail ou número de WhatsApp" className="min-w-64 flex-1" />
              <Button type="button" variant="outline" disabled={!!preparedWhatsApp || !!pendingWhatsAppIds} onClick={() => void pickContact("tel")}>Escolher contacto</Button>
              <Button type="button" variant="outline" disabled={!!preparedWhatsApp || !!pendingWhatsAppIds} onClick={() => void pickContact("email")}>Escolher e-mail</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!!sharing || !!exporting || !!preparedWhatsApp || !!pendingWhatsAppIds || !selectedTickets.length} onClick={() => void prepareWhatsAppFiles()}>
                <MessageCircle className="h-4 w-4" />{sharing === "whatsapp" ? "A preparar ficheiros…" : "Preparar ficheiros para WhatsApp"}
              </Button>
              <Button variant="secondary" disabled={!!sharing || !!exporting || !!preparedWhatsApp || !!pendingWhatsAppIds || !selectedTickets.length} onClick={() => void shareSelected("email")}>
                <Mail className="h-4 w-4" />{sharing === "email" ? "A enviar…" : "E-mail"}
              </Button>
              <Button variant="secondary" disabled={!!sharing || !!exporting || !!preparedWhatsApp || !!pendingWhatsAppIds || !selectedTickets.length} onClick={() => void shareSelected("link")}>
                <Link2 className="h-4 w-4" />{sharing === "link" ? "A copiar…" : "Copiar mensagem/link"}
              </Button>
              <span className="self-center text-xs text-muted-foreground">{selectedTickets.length} selecionada(s)</span>
            </div>
            {preparedWhatsApp && (
              <div className="space-y-2 rounded-md bg-secondary/60 p-3">
                <p className="text-sm">{preparedWhatsApp.files.length === 1 ? preparedWhatsApp.files[0].name : `${preparedWhatsApp.files.length} ficheiros prontos`}</p>
                <p className="text-xs text-muted-foreground">No menu do dispositivo, escolha WhatsApp e selecione o destinatário. O navegador não pode escolher automaticamente a aplicação nem enviar a mensagem sem a sua confirmação. Se usar a alternativa manual, várias mesas são reunidas num ZIP com ficheiros individuais nomeados.</p>
                <div className="flex flex-wrap gap-2">
                  {preparedWhatsApp.nativeAvailable ? (
                    <Button disabled={!!sharing} onClick={() => void sharePreparedWhatsApp()}>
                      {sharing === "native" ? "A abrir partilha…" : "Partilhar ficheiro(s)"}
                    </Button>
                  ) : (
                    <Button variant="secondary" disabled={!!sharing} onClick={() => void fallbackWhatsApp()}>
                      {sharing === "fallback" ? "A preparar…" : "Descarregar e abrir WhatsApp"}
                    </Button>
                  )}
                  <Button variant="ghost" disabled={!!sharing} onClick={() => setPreparedWhatsApp(null)}>Cancelar</Button>
                </div>
              </div>
            )}
            {pendingWhatsAppIds && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 p-3">
                <p className="flex-1 text-sm">Quando terminar o envio do anexo no WhatsApp, confirme aqui para atualizar o estado das mesas.</p>
                <Button disabled={!!sharing} onClick={() => void confirmWhatsAppSent()}>
                  {sharing === "whatsapp" ? "A guardar…" : "Confirmar que enviei"}
                </Button>
                <Button variant="ghost" disabled={!!sharing} onClick={() => { setPendingWhatsAppIds(null); setPendingWhatsAppContact(null); }}>Ainda não enviei</Button>
              </div>
            )}
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pesquisar código ou titular"
              className="pl-9"
            />
          </div>

          <div className="divide-y border-y">
            {isLoading ? (
              <p className="py-6 text-sm text-muted-foreground">A carregar mesas…</p>
            ) : ticketsError ? (
              <p className="py-6 text-sm text-destructive">
                Não foi possível carregar os ingressos deste grupo:{" "}
                {(ticketsError as Error).message}
              </p>
            ) : visible.length ? (
              visible.map((ticket) => (
                <div
                  key={ticket.id}
                  className="grid gap-3 py-3 sm:grid-cols-[auto_minmax(150px,1fr)_minmax(220px,1.3fr)_auto] sm:items-center"
                >
                  <Checkbox
                    checked={selectedIds.has(ticket.id)}
                    disabled={
                      !!preparedWhatsApp ||
                      !!pendingWhatsAppIds ||
                      ticket.status !== "valid" ||
                      !!ticket.printed_at ||
                      !!ticket.share_id ||
                      !!ticket.sent_at ||
                      ticket.email_delivery_status === "sending" ||
                      ticket.email_delivery_status === "sent"
                    }
                    aria-label={`Selecionar mesa ${ticket.seq}`}
                    onCheckedChange={(checked) => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (checked) next.add(ticket.id);
                        else next.delete(ticket.id);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">{ticket.code}</p>
                    <p className="text-xs text-muted-foreground">Mesa #{ticket.seq}</p>
                  </div>
                  <div className="relative">
                    <UserRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      disabled={!!exporting || !!preparedWhatsApp || !!pendingWhatsAppIds}
                      value={names[ticket.id] ?? ticket.holder_name ?? ""}
                      onChange={(event) =>
                        setNames((current) => ({ ...current, [ticket.id]: event.target.value }))
                      }
                      onBlur={(event) => void saveName(ticket, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      aria-label={`Titular da mesa ${ticket.seq}`}
                      placeholder="Nome do cliente desta mesa"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Badge variant={ticket.status === "valid" ? "outline" : "secondary"}>
                      {ticket.status === "used"
                        ? "Entrada validada"
                        : ticket.status === "void"
                          ? "Anulado"
                          : "Válido"}
                    </Badge>
                    {ticket.printed_at && (
                      <span className="text-xs text-muted-foreground">Impresso</span>
                    )}
                    {!ticket.printed_at && (ticket.sent_at || ticket.share_id || ticket.email_delivery_status === "sent") && (
                      <span className="text-xs text-muted-foreground">Distribuída</span>
                    )}
                    {ticket.email_delivery_status === "sending" && (
                      <span className="text-xs text-muted-foreground">A enviar</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {currentTickets.length
                  ? "Nenhuma mesa corresponde à pesquisa."
                  : "Ainda não há códigos de mesa. Gere-os para associar titulares."}
              </p>
            )}
          </div>
        </>
      )}
      <Dialog open={previewMode !== null} onOpenChange={(open) => !open && setPreviewMode(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pré-visualização antes de {previewMode === "print" ? "imprimir" : "gerar os digitais"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Confirme a arte final deste ingresso. O nome individual está aplicado junto do código de
            referência e do QR. Pode percorrer as mesas disponíveis antes de continuar.
          </p>
          {previewTicket && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold">{previewTicket.code}</p>
                <p className="text-sm text-muted-foreground">
                  {previewGroup?.name} · Mesa #{previewTicket.seq} · {previewName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={previewIndex === 0}
                  onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}
                >
                  Anterior
                </Button>
                <span className="min-w-16 text-center text-xs text-muted-foreground">
                  {previewIndex + 1} / {selectedTickets.length}
                </span>
                <Button
                  variant="secondary"
                  disabled={previewIndex >= selectedTickets.length - 1}
                  onClick={() =>
                    setPreviewIndex((index) => Math.min(selectedTickets.length - 1, index + 1))
                  }
                >
                  Seguinte
                </Button>
              </div>
            </div>
          )}
          <div className="grid min-h-64 place-items-center overflow-hidden rounded-md border bg-secondary p-3">
            {previewLoading ? (
              <p className="text-sm text-muted-foreground">A preparar a arte…</p>
            ) : previewImage ? (
              <img
                src={previewImage}
                alt={`Pré-visualização do ingresso ${previewTicket?.code} para ${previewName}`}
                className="max-h-[58vh] max-w-full object-contain shadow-lg"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                A pré-visualização não está disponível.
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreviewMode(null)}>
              Voltar à edição
            </Button>
            <Button disabled={previewLoading || !previewImage} onClick={() => void confirmExport()}>
              {previewMode === "print" ? (
                <Printer className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {previewMode === "print" ? "Confirmar impressão A4" : "Confirmar ficheiros digitais"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
