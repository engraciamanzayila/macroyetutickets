import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Printer, Search, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureTickets,
  fetchAllTickets,
  generate,
  type Group,
  type TicketRow,
} from "@/lib/generate";
import { exportForPrint } from "@/lib/print";
import { DEFAULT_LAYOUT, renderTicket } from "@/lib/render";
import { loadArt } from "@/lib/generate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<"digital" | "print" | null>(null);
  const [previewMode, setPreviewMode] = useState<"digital" | "print" | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const group = tableGroups.find((item) => item.id === groupId) ?? tableGroups[0];

  useEffect(() => {
    if (!tableGroups.some((item) => item.id === groupId)) setGroupId(tableGroups[0]?.id ?? "");
  }, [groupId, tableGroups]);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["table-tickets", eventId, tableGroups.map((item) => item.id)],
    queryFn: async () => {
      const groupsTickets = await Promise.all(
        tableGroups.map(async (item) => ({
          groupId: item.id,
          tickets: await fetchAllTickets({ group_id: item.id }),
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
      ticket.status === "valid" && !ticket.printed_at && !ticket.share_id && !ticket.sent_at,
  );
  const previewTicket = availableTickets[previewIndex];
  const previewName = previewTicket
    ? (names[previewTicket.id] ?? previewTicket.holder_name ?? "")
    : "";

  useEffect(() => {
    if (!previewMode || !group?.art_path || !previewTicket) {
      setPreviewImage("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    loadArt(group.art_path)
      .then(async (art) => {
        try {
          const canvas = await renderTicket(
            art,
            group.layout ?? DEFAULT_LAYOUT,
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
  }, [group, previewMode, previewName, previewTicket]);

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
      toast.success("Códigos das mesas atualizados. Cada uma pode agora receber o seu titular.");
    } catch (error) {
      toast.error("Não foi possível gerar os códigos: " + (error as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const persistPendingNames = async () => {
    const changed = currentTickets.filter((ticket) => {
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
    if (!group) return false;
    if (currentTickets.length < group.quantity) {
      toast.error("Gere primeiro os códigos em falta para este grupo de mesas.");
      return false;
    }
    if (!group.layout) {
      toast.error("Posicione primeiro o QR no editor deste grupo.");
      return false;
    }
    if (!availableTickets.length) {
      toast.error("Não há mesas digitais disponíveis para exportar neste grupo.");
      return false;
    }
    const unnamed = availableTickets.filter(
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
    if (!group || exporting) return;
    setExporting("digital");
    try {
      await persistPendingNames();
      const count = await generate(
        [group],
        ["zip", "pdf"],
        `${eventName}_${group.name}_mesas_digitais`,
        () => {},
      );
      if (!count) throw new Error("Não há ingressos digitais disponíveis para exportar");
      toast.success(`${count} mesa(s) exportada(s) com QR, referência e nome do cliente.`);
      await qc.invalidateQueries({ queryKey: ["table-tickets", eventId] });
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
      const result = await exportForPrint(
        [{ g: group, count: availableTickets.length }],
        `${eventName}_${group.name}_mesas`,
        () => {},
        eventId,
      );
      toast.success(
        `${result.total} mesa(s) em ${result.pages} folha(s) A4, com nome, QR e referência.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["table-tickets", eventId] }),
        qc.invalidateQueries({ queryKey: ["print-history", eventId] }),
        qc.invalidateQueries({ queryKey: ["report", eventId] }),
      ]);
    } catch (error) {
      toast.error("Falha ao exportar para impressão: " + (error as Error).message);
    } finally {
      setExporting(null);
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
              <Badge variant="outline">{named} com titular</Badge>
              <Badge variant="outline">
                {Math.max(0, group.quantity - currentTickets.length)} por gerar
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
                disabled={!!exporting || generating}
              >
                <Download className="h-4 w-4" />
                {exporting === "digital" ? "A gerar digitais…" : "Baixar digitais (ZIP + PDF)"}
              </Button>
              <Button onClick={() => requestExport("print")} disabled={!!exporting || generating}>
                <Printer className="h-4 w-4" />
                {exporting === "print" ? "A paginar…" : "Imprimir em A4"}
              </Button>
            </div>
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
            ) : visible.length ? (
              visible.map((ticket) => (
                <div
                  key={ticket.id}
                  className="grid gap-3 py-3 sm:grid-cols-[minmax(150px,1fr)_minmax(220px,1.3fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">{ticket.code}</p>
                    <p className="text-xs text-muted-foreground">Mesa #{ticket.seq}</p>
                  </div>
                  <div className="relative">
                    <UserRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      disabled={!!exporting}
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
                  Mesa #{previewTicket.seq} · {previewName}
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
                  {previewIndex + 1} / {availableTickets.length}
                </span>
                <Button
                  variant="secondary"
                  disabled={previewIndex >= availableTickets.length - 1}
                  onClick={() =>
                    setPreviewIndex((index) => Math.min(availableTickets.length - 1, index + 1))
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
