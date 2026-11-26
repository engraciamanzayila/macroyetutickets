import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Unlink, QrCode, RefreshCw, Printer, ListChecks } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Group } from "@/lib/generate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MY_TICKETS_OFFICIAL_LOGO } from "@/assets/my-tickets-official-logo";

type TableCard = {
  id: string;
  event_id: string;
  group_id: string;
  source_ticket_id: string | null;
  card_type: "MESA" | "BOX";
  card_number: number;
  holder_name: string | null;
  capacity: number | null;
  physical_identifier_type: "MESA" | "BOX" | null;
  physical_identifier_number: number | null;
  qr_token: string;
  status: "valid" | "void";
  created_at: string;
};

const db = supabase as any;

function cardTypeFor(group?: Group): "MESA" | "BOX" {
  if (!group) return "MESA";
  const labels = (group.ticket_type + " " + group.name).toUpperCase();
  if (labels.includes("BOX")) return "BOX";
  if (labels.includes("MESA")) return "MESA";
  return Number(group.price ?? 0) === 1_000_000 ? "BOX" : "MESA";
}

export function TableIdCardsPanel({
  eventId,
  eventName,
  groups,
}: {
  eventId: string;
  eventName: string;
  groups: Group[];
}) {
  const qc = useQueryClient();
  const eligibleGroups = useMemo(
    () => groups.filter((g) =>
      g.ticket_type.toUpperCase().includes("MESA") ||
      g.ticket_type.toUpperCase().includes("BOX") ||
      g.name.toUpperCase().includes("MESA") ||
      g.name.toUpperCase().includes("BOX") ||
      Number(g.price ?? 0) === 1_000_000
    ),
    [groups],
  );
  const [syncing, setSyncing] = useState(false);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);

  const { data: cards = [], isLoading, error } = useQuery<TableCard[]>({
    queryKey: ["event-table-id-cards", eventId],
    queryFn: async () => {
      const allCards: TableCard[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("event_table_cards")
          .select("*").eq("event_id", eventId)
          .order("created_at", { ascending: false }).range(from, from + 999);
        if (error) throw error;
        allCards.push(...((data ?? []) as TableCard[]));
        if (!data || data.length < 1000) break;
      }
      return allCards;
    },
  });

  const assigned = useMemo(() => new Set(
    cards.filter((c) => c.physical_identifier_type && c.physical_identifier_number)
      .map((c) => `${c.physical_identifier_type}:${c.physical_identifier_number}`)
  ), [cards]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["event-table-id-cards", eventId] });
  };

  const synchronizeCards = async () => {
    if (syncing || !eligibleGroups.length) return;
    setSyncing(true);
    try {
      const targetMesa = eligibleGroups.filter((g) => cardTypeFor(g) === "MESA").reduce((n, g) => n + Number(g.quantity || 0), 0);
      const targetBox = eligibleGroups.filter((g) => cardTypeFor(g) === "BOX").reduce((n, g) => n + Number(g.quantity || 0), 0);
      if (![targetMesa, targetBox].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("As quantidades configuradas para mesas e boxes são inválidas.");
      const currentMesa = cards.filter((c) => c.card_type === "MESA").length;
      const currentBox = cards.filter((c) => c.card_type === "BOX").length;
      if (currentMesa > targetMesa || currentBox > targetBox) throw new Error("Já existem mais cartões do que a quantidade configurada. Reveja os cartões existentes; nenhum será apagado automaticamente.");
      const existingByGroup = new Map<string, TableCard[]>();
      cards.forEach((card) => existingByGroup.set(card.group_id, [...(existingByGroup.get(card.group_id) || []), card]));
      const rows = await Promise.all(eligibleGroups.map(async (g) => {
        const result = await db.from("tickets").select("id,seq,holder_name").eq("event_id", eventId).eq("group_id", g.id).order("seq");
        if (result.error) throw result.error;
        return { group: g, tickets: result.data || [] };
      }));
      let mesaNo = cards.filter((c) => c.card_type === "MESA").reduce((n, c) => Math.max(n, c.card_number), 0);
      let boxNo = cards.filter((c) => c.card_type === "BOX").reduce((n, c) => Math.max(n, c.card_number), 0);
      const inserts: Record<string, unknown>[] = [];
      for (const row of rows) {
        const existing = existingByGroup.get(row.group.id) || [];
        const missingCount = Math.max(0, Number(row.group.quantity || 0) - existing.length);
        const kind = cardTypeFor(row.group);
        const linkedIds = new Set(existing.map((card) => card.source_ticket_id).filter(Boolean));
        const candidates = row.tickets.filter((ticket: { id: string }) => !linkedIds.has(ticket.id));
        for (let i = 0; i < missingCount; i++) {
          const ticket = candidates[i];
          if (kind === "BOX") boxNo++; else mesaNo++;
          inserts.push({ event_id: eventId, group_id: row.group.id, source_ticket_id: ticket ? ticket.id : null, card_type: kind, card_number: kind === "BOX" ? boxNo : mesaNo, holder_name: ticket && ticket.holder_name ? ticket.holder_name.trim() : null, capacity: null });
        }
      }
      if (inserts.length) { const result = await db.from("event_table_cards").insert(inserts); if (result.error) throw result.error; }
      await refresh();
      toast.success(inserts.length ? inserts.length + " cartão(ões) criados; nomes existentes importados." : "Cartões já sincronizados com as quantidades configuradas.");
    } catch (e) { toast.error("Falha na sincronização: " + (e as Error).message); }
    finally { setSyncing(false); }
  };
  const importOfficialTableList = async () => {
    if (syncing || isLoading) return;
    setSyncing(true);
    try {
      const officialRows = [["Estefânia Morais",300000,4],["Euclides José",300000,4],["Miguel Bumba",300000,4],["Sidraque Chivinga + 1",300000,4],["Lukeny Simba",300000,4],["Joaquim Santos",300000,4],["Paulo de Carvalhos",300000,4],["Lucas João",300000,4],["Ernesto Muluta",300000,4],["Ivan Águas",300000,4],["Afonso Salvador",300000,4],["Dalila Vicente",300000,4],["Dimple",300000,4],["Elvira Pinheiro",300000,4],["Helena",300000,4],["Mário",300000,4],["Miguel Makuntima Jr",300000,4],["Noémia Januário",300000,4],["Vitor Manuel - Iria Aires",300000,4],["Miguel Dias",300000,4],["Deise",300000,4],["Água",300000,4],["DICKLAS THE ANGOLAN BOY",300000,4],["DICKLAS ONE FAMILIA",300000,4],["Drwisska Panzo",300000,4],["John Marta",500000,5],["Augusto Group",500000,5],["Simione Cardoso",500000,5],["Mauro Chivas",500000,5],["Marussia",500000,5],["Pamela Games",500000,5],["Roberto Diniz + 1 Fitas",500000,5],["Mariquinha Bastos + 2 Fitas",500000,5],["Garcia Paca",500000,5],["Virginia Feca",500000,5],["Mary Business",500000,5],["Jéssio Bravo",500000,5],["Daniel Vilinga",500000,5],["Clinton dos Santos",500000,5],["Carlos Quental",500000,5],["Nzinga Vela",1000000,8],["Olívio",1000000,8],["Linn Endresen + 1 Fita",1000000,8],["José Munar",1000000,8],["Lagrifa",1000000,8],["Donato Viegas",1000000,8],["Elias Cruz",1000000,8],["Preto Show",1000000,8],["Darcia Nunes",1000000,8],["Anderson Belmiro",1000000,8]] as Array<[string, number, number]>;
      if (officialRows.length !== 50) throw new Error("A lista oficial deve conter 50 mesas.");
      const findGroup = (price: number) => eligibleGroups.find((g) =>
        Number(g.price ?? 0) === price &&
        (g.name.toUpperCase().includes("MESA") || g.ticket_type.toUpperCase().includes("MESA"))
      );
      const groupsByPrice = new Map<number, Group>();
      for (const price of [300000, 500000, 1000000]) {
        const group = findGroup(price);
        if (!group) throw new Error("Não encontrei um grupo de mesa de " + price.toLocaleString("pt-AO") + " Kz neste evento. Nenhum cartão foi alterado.");
        groupsByPrice.set(price, group);
      }

      const { data, error } = await db.from("event_table_cards")
        .select("*").eq("event_id", eventId);
      if (error) throw error;
      const existing = (data ?? []) as TableCard[];
      const conflicts = existing.filter((card) =>
        card.physical_identifier_type === "MESA" &&
        card.physical_identifier_number !== null &&
        (card.physical_identifier_number < 1 || card.physical_identifier_number > 50)
      );
      if (conflicts.length) throw new Error("Existem identificadores MESA fora da lista oficial (01–50). Nenhum cartão foi alterado; reveja essas associações primeiro.");

      const usedIds = new Set(existing.filter((c) => c.physical_identifier_type === "MESA" && c.physical_identifier_number)
        .map((c) => c.physical_identifier_number as number));
      const duplicates = [...usedIds].filter((n) => existing.filter((c) => c.physical_identifier_type === "MESA" && c.physical_identifier_number === n).length > 1);
      if (duplicates.length) throw new Error("Há identificadores físicos repetidos: " + duplicates.join(", ") + ". Corrija as duplicações antes da importação.");

      let created = 0, updated = 0, unchanged = 0;
      for (let index = 0; index < officialRows.length; index++) {
        const [holder, price, capacity] = officialRows[index];
        const number = index + 1;
        const group = groupsByPrice.get(price)!;
        let card = existing.find((c) => c.physical_identifier_type === "MESA" && c.physical_identifier_number === number);
        if (!card) {
          card = existing.find((c) => c.card_type === "MESA" && c.card_number === number);
        }
        const patch = {
          group_id: group.id,
          card_type: "MESA",
          card_number: number,
          holder_name: holder,
          capacity,
          physical_identifier_type: "MESA",
          physical_identifier_number: number,
        };
        if (card) {
          if (card.physical_identifier_type && card.physical_identifier_type !== "MESA") {
            throw new Error("O cartão #" + number + " já está associado a um identificador de outro tipo. Nenhuma alteração adicional foi feita.");
          }
          const result = await db.from("event_table_cards").update(patch)
            .eq("id", card.id).eq("event_id", eventId);
          if (result.error) throw result.error;
          updated++;
        } else {
          const result = await db.from("event_table_cards").insert({ ...patch, event_id: eventId });
          if (result.error) throw result.error;
          created++;
        }
      }
      await refresh();
      toast.success("Lista oficial aplicada: 50 mesas associadas (25 de 300 mil, 15 de 500 mil e 10 de 1 milhão). Criados: " + created + "; actualizados: " + updated + ".");
    } catch (e) {
      toast.error("Não foi possível aplicar a lista oficial: " + (e as Error).message);
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const associateRemainingBlankTables = async () => {
    if (syncing || isLoading) return;
    setSyncing(true);
    try {
      const { data, error } = await db.from("event_table_cards")
        .select("*").eq("event_id", eventId).eq("card_type", "MESA");
      if (error) throw error;
      const existing = (data ?? []) as TableCard[];
      const targets = Array.from({ length: 30 }, (_, index) => index + 51);
      const cardsByNumber = new Map<number, TableCard[]>();
      for (const card of existing) cardsByNumber.set(card.card_number, [...(cardsByNumber.get(card.card_number) || []), card]);
      const missing = targets.filter((number) => (cardsByNumber.get(number) || []).length !== 1);
      if (missing.length) throw new Error("Não encontrei exactamente um cartão MESA para cada número de 51 a 80. Números em falta ou duplicados: " + missing.join(", ") + ". Sincronize/reveja os cartões antes de continuar.");
      const conflicts = existing.filter((card) => card.physical_identifier_type === "MESA" && card.physical_identifier_number !== null && card.physical_identifier_number >= 51 && card.physical_identifier_number <= 80 && card.card_number !== card.physical_identifier_number);
      if (conflicts.length) throw new Error("Já existem identificadores MESA 51–80 associados a outros cartões. Nenhuma alteração foi feita.");
      for (const number of targets) {
        const card = cardsByNumber.get(number)![0];
        if (card.physical_identifier_type && (card.physical_identifier_type !== "MESA" || card.physical_identifier_number !== number)) throw new Error("O cartão MESA " + String(number).padStart(2, "0") + " já tem outro identificador físico. Nenhuma alteração foi feita.");
      }
      let updated = 0;
      for (const number of targets) {
        const card = cardsByNumber.get(number)![0];
        const result = await db.from("event_table_cards").update({ physical_identifier_type: "MESA", physical_identifier_number: number, holder_name: null }).eq("id", card.id).eq("event_id", eventId);
        if (result.error) throw result.error;
        updated++;
      }
      await refresh();
      toast.success(updated + " cartões em branco associados às mesas MESA 51–80. A capacidade e a categoria existentes foram preservadas.");
    } catch (e) {
      toast.error("Não foi possível associar as mesas em branco: " + (e as Error).message);
      await refresh();
    } finally { setSyncing(false); }
  };
  const saveCapacity = async (card: TableCard, value: string) => {
    const cap = value.trim() === "" ? null : Number(value);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 1000))
      return toast.error("Capacidade inválida. Use um número entre 1 e 1000 ou deixe em branco.");
    const { error } = await db.from("event_table_cards")
      .update({ capacity: cap }).eq("id", card.id).eq("event_id", eventId);
    if (error) return toast.error("Não foi possível guardar a capacidade: " + error.message);
    await refresh();
  };

  const assignIdentifier = async (card: TableCard, value: string) => {
    const [kind, rawNumber] = value.split(":");
    const number = Number(rawNumber);
    const patch = value
      ? { physical_identifier_type: kind, physical_identifier_number: number }
      : { physical_identifier_type: null, physical_identifier_number: null };
    const { error } = await db.from("event_table_cards")
      .update(patch).eq("id", card.id).eq("event_id", eventId);
    if (error) {
      toast.error(error.message.includes("event_table_cards_physical_identifier_unique")
        ? "Este identificador já está associado a outro cartão."
        : "Não foi possível associar o identificador: " + error.message);
      return;
    }
    toast.success(value ? "Identificador associado ao cartão." : "Identificador desassociado.");
    await refresh();
  };

  const makeQr = async (card: TableCard) => {
    try {
      const url = `${window.location.origin}/validar-mesa/${card.qr_token}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: "H" });
      setQrImages((current) => ({ ...current, [card.id]: dataUrl }));
    } catch (e) {
      toast.error("Não foi possível gerar o QR: " + (e as Error).message);
    }
  };

  const printCards = async (requested: TableCard[]) => {
    const printable = requested.filter((card) =>
      card.status === "valid" && card.physical_identifier_type && card.physical_identifier_number && card.capacity !== null,
    );
    if (!printable.length) {
      toast.error("Antes de imprimir, associe o identificador físico e defina a capacidade dos cartões.");
      return;
    }
    setPrinting(true);
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const cardW = 94, cardH = 52, gapX = 6, gapY = 5;
      const marginX = (210 - (cardW * 2 + gapX)) / 2, marginY = 8, perPage = 10;
      for (let index = 0; index < printable.length; index++) {
        if (index > 0 && index % perPage === 0) pdf.addPage("a4", "portrait");
        const card = printable[index];
        const pos = index % perPage, col = pos % 2, row = Math.floor(pos / 2);
        const x = marginX + col * (cardW + gapX), y = marginY + row * (cardH + gapY);
        const group = groups.find((item) => item.id === card.group_id);
        const physicalLabel = card.physical_identifier_type + " " + String(card.physical_identifier_number).padStart(2, "0");

        pdf.setDrawColor(145, 145, 145); pdf.setLineWidth(0.25);
        pdf.roundedRect(x, y, cardW, cardH, 1.5, 1.5, "S");
        pdf.setDrawColor(80, 80, 80); pdf.setLineWidth(0.35);
        const mark = 3;
        pdf.line(x - 1, y, x + mark, y); pdf.line(x + cardW - mark, y, x + cardW + 1, y);
        pdf.line(x - 1, y + cardH, x + mark, y + cardH); pdf.line(x + cardW - mark, y + cardH, x + cardW + 1, y + cardH);

        pdf.addImage(MY_TICKETS_OFFICIAL_LOGO, "JPEG", x + 5, y + 1, 24, 9.72);
        pdf.setTextColor(35, 35, 35); pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5);
        pdf.text(eventName || "Evento", x + 5, y + 12, { maxWidth: cardW - 10 });
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(19);
        pdf.text(physicalLabel, x + 5, y + 23);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
        pdf.text(group ? "MESA · " + Number(group.price ?? 0).toLocaleString("pt-AO") + " Kz" : "Categoria", x + 5, y + 28, { maxWidth: 62 });
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
        pdf.text("CAPACIDADE: " + card.capacity + " PESSOAS", x + 5, y + 34);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5);
        pdf.text("RESPONSÁVEL", x + 5, y + 40);
        if (card.holder_name?.trim()) {
          pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
          pdf.text(card.holder_name.trim(), x + 5, y + 46, { maxWidth: 61 });
        } else {
          pdf.setDrawColor(70, 70, 70); pdf.setLineWidth(0.25);
          pdf.line(x + 5, y + 47, x + 64, y + 47);
        }
        const qrUrl = window.location.origin + "/validar-mesa/" + card.qr_token;
        const qrData = await QRCode.toDataURL(qrUrl, { width: 360, margin: 1, errorCorrectionLevel: "H" });
        pdf.addImage(qrData, "PNG", x + 69, y + 25, 20, 20);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(5.5);
        pdf.text("VALIDAÇÃO", x + 79, y + 48, { align: "center" });
      }
      const suffix = printable.length === 1
        ? printable[0].physical_identifier_type + "-" + String(printable[0].physical_identifier_number).padStart(2, "0")
        : printable.length + "-cartoes";
      pdf.save("MY-Tickets-ID-Mesas-" + suffix + ".pdf");
      toast.success(printable.length + " cartão(ões) preparado(s) para impressão.");
    } catch (e) {
      toast.error("Não foi possível preparar o PDF: " + (e as Error).message);
    } finally {
      setPrinting(false);
    }
  };

  const toggleCardSelection = (cardId: string, checked: boolean) => {
    setSelectedCardIds((current) => {
      const next = new Set(current);
      if (checked) next.add(cardId); else next.delete(cardId);
      return next;
    });
  };

  const downloadQr = (card: TableCard) => {
    const dataUrl = qrImages[card.id];
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `MY-Tickets-${card.card_type}-${String(card.card_number).padStart(2, "0")}-QR.png`;
    link.click();
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Cartões de identificação de mesa</h2>
        <p className="text-sm text-muted-foreground">
          Primeiro cria-se o cartão e define-se a categoria. Depois associa-se o identificador físico disponível. Os identificadores não criam nem numeram os cartões.
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-semibold">Sincronização automática</h3><p className="text-sm text-muted-foreground">A quantidade vem dos grupos de mesas do evento. Os nomes existentes nos ingressos são importados automaticamente; quando não houver nome, o cartão mantém o espaço em branco para preenchimento à mão depois da impressão. Os cartões são gerados em lote — não é necessário criar nomes manualmente.</p></div>
          <Button onClick={() => void synchronizeCards()} disabled={syncing || isLoading || !eligibleGroups.length}><RefreshCw className="h-4 w-4" />{syncing ? "A sincronizar…" : "Sincronizar cartões"}</Button>
          <Button variant="outline" onClick={() => void importOfficialTableList()} disabled={syncing || isLoading}><ListChecks className="h-4 w-4" />{syncing ? "A aplicar lista…" : "Aplicar lista oficial · 50 mesas"}</Button>
          <Button variant="outline" onClick={() => void associateRemainingBlankTables()} disabled={syncing || isLoading}><ListChecks className="h-4 w-4" />{syncing ? "A associar…" : "Associar mesas em branco · 51–80"}</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <div className="rounded-lg bg-muted p-3"><p className="text-muted-foreground">MESA · identificadores dinâmicos</p><p className="font-semibold">{cards.filter((c) => c.card_type === "MESA").length} cartões / {eligibleGroups.filter((g) => cardTypeFor(g) === "MESA").reduce((n, g) => n + Number(g.quantity || 0), 0)} configurados</p></div>
          <div className="rounded-lg bg-muted p-3"><p className="text-muted-foreground">BOX · identificadores dinâmicos · 1.000.000 Kz</p><p className="font-semibold">{cards.filter((c) => c.card_type === "BOX").length} cartões / {eligibleGroups.filter((g) => cardTypeFor(g) === "BOX").reduce((n, g) => n + Number(g.quantity || 0), 0)} configurados</p></div>
        </div>
        <p className="text-xs text-muted-foreground">A sincronização não apaga cartões existentes. A impressão em lote só será liberada quando as quantidades estiverem certas e todos os identificadores físicos estiverem associados.</p>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Cartões criados</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{cards.length} cartões</Badge>
            <Badge variant="outline">{cards.filter((c) => c.physical_identifier_type).length} identificadores associados</Badge>
            <Button size="sm" variant="outline" disabled={printing || cards.filter((c) => c.status === "valid" && c.physical_identifier_type === "MESA" && c.physical_identifier_number !== null && c.physical_identifier_number >= 1 && c.physical_identifier_number <= 50 && c.capacity !== null).length !== 50} onClick={() => void printCards(cards.filter((c) => c.status === "valid" && c.physical_identifier_type === "MESA" && c.physical_identifier_number !== null && c.physical_identifier_number >= 1 && c.physical_identifier_number <= 50))}>
              <Printer className="h-4 w-4" /> Imprimir lista oficial (50)
            </Button>
            <Button size="sm" variant="outline" disabled={printing || cards.filter((c) => c.status === "valid" && c.physical_identifier_type === "MESA" && c.physical_identifier_number !== null && c.physical_identifier_number >= 51 && c.physical_identifier_number <= 80 && c.capacity !== null && !c.holder_name?.trim()).length !== 30} onClick={() => void printCards(cards.filter((c) => c.status === "valid" && c.physical_identifier_type === "MESA" && c.physical_identifier_number !== null && c.physical_identifier_number >= 51 && c.physical_identifier_number <= 80 && !c.holder_name?.trim()))}>
              <Printer className="h-4 w-4" /> Imprimir mesas em branco (30)
            </Button>
            <Button size="sm" variant="outline" disabled={printing || !cards.some((c) => c.status === "valid" && c.physical_identifier_type && c.capacity !== null)} onClick={() => void printCards(cards)}>
              <Printer className="h-4 w-4" /> Imprimir todos associados
            </Button>
            <Button size="sm" disabled={printing || !selectedCardIds.size} onClick={() => void printCards(cards.filter((c) => selectedCardIds.has(c.id)))}>
              <Printer className="h-4 w-4" /> Imprimir selecionados ({selectedCardIds.size})
            </Button>
          </div>
        </div>
        {isLoading ? <p className="py-6 text-sm text-muted-foreground">A carregar cartões…</p> :
         error ? <p className="py-6 text-sm text-destructive">Erro ao carregar cartões: {(error as Error).message}</p> :
         cards.length ? <div className="divide-y rounded-xl border">
          {cards.map((card) => {
            const group = groups.find((g) => g.id === card.group_id);
            const assignedValue = card.physical_identifier_type && card.physical_identifier_number
              ? `${card.physical_identifier_type}:${card.physical_identifier_number}` : "";
            const targetCount = eligibleGroups.filter((g) => cardTypeFor(g) === card.card_type).reduce((n, g) => n + Number(g.quantity || 0), 0);
            const currentMax = cards.filter((item) => item.physical_identifier_type === card.card_type).reduce((n, item) => Math.max(n, item.physical_identifier_number ?? 0), 0);
            const max = Math.max(card.card_type === "BOX" ? 20 : 80, targetCount, currentMax);
            return <article key={card.id} className="grid gap-3 p-4 lg:grid-cols-[auto_minmax(170px,1fr)_minmax(180px,1fr)_minmax(190px,1fr)_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label={"Selecionar cartão " + card.card_type + " " + card.card_number} checked={selectedCardIds.has(card.id)} disabled={card.status !== "valid" || !card.physical_identifier_type || card.capacity === null} onChange={(e) => toggleCardSelection(card.id, e.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
                <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={card.card_type === "BOX" ? "default" : "secondary"}>{card.card_type}</Badge>
                  <span className="font-mono font-semibold">#{String(card.card_number).padStart(2, "0")}</span>
                </div>
                <p className="text-sm font-medium">{group?.name ?? "Categoria"}</p>
                <p className="text-xs text-muted-foreground">{group ? Number(group.price ?? 0).toLocaleString("pt-AO") + " Kz" : eventName}</p>
                <p className="text-xs text-muted-foreground">{card.holder_name?.trim() ? "Responsável: " + card.holder_name : "Nome em branco para preencher à mão após a impressão"}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 space-y-1 text-xs">
                  <span>Capacidade (pessoas)</span>
                  <Input key={`${card.id}-capacity-${card.capacity}`} type="number" min="1" max="1000" defaultValue={card.capacity ?? ""} placeholder="Definir pessoas"
                    onBlur={(e) => {
                      if ((e.currentTarget.value.trim() === "" ? null : Number(e.currentTarget.value)) !== card.capacity) void saveCapacity(card, e.currentTarget.value);
                    }} />
                  <p className="text-xs text-muted-foreground">{card.capacity === null ? "Capacidade por definir — necessária antes da impressão." : "Número de pessoas permitido nesta mesa."}</p>
                </label>
              </div>
              <label className="space-y-1 text-xs">
                <span>Identificador físico ({card.card_type} 01–{String(max).padStart(2, "0")})</span>
                <select value={assignedValue} onChange={(e) => void assignIdentifier(card, e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">Ainda não associado</option>
                  {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
                    const key = `${card.card_type}:${n}`;
                    const usedByOther = assigned.has(key) && key !== assignedValue;
                    return <option key={key} value={key} disabled={usedByOther}>
                      {card.card_type} {String(n).padStart(2, "0")}{usedByOther ? " · já atribuído" : ""}
                    </option>;
                  })}
                </select>
                <p className="text-xs text-muted-foreground">
                  {assignedValue ? `Associado: ${card.card_type} ${String(card.physical_identifier_number).padStart(2, "0")}` : "Escolha o identificador depois de criar o cartão."}
                </p>
              </label>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button size="sm" variant="outline" onClick={() => void makeQr(card)}>
                  <QrCode className="h-4 w-4" /> QR
                </Button>
                <Button size="sm" variant="outline" disabled={printing || card.status !== "valid" || !card.physical_identifier_type || card.capacity === null} onClick={() => void printCards([card])}>
                  <Printer className="h-4 w-4" /> Imprimir cartão
                </Button>
                {qrImages[card.id] && <>
                  <img src={qrImages[card.id]} alt={`QR do cartão ${card.card_type} ${card.card_number}`} className="h-16 w-16 rounded border bg-white p-1" />
                  <Button size="sm" variant="ghost" onClick={() => downloadQr(card)}>Baixar QR</Button>
                </>}
                {assignedValue && <Button size="icon" variant="ghost" title="Desassociar identificador" onClick={() => void assignIdentifier(card, "")}>
                  <Unlink className="h-4 w-4" />
                </Button>}
              </div>
            </article>;
          })}
         </div> : <p className="rounded-xl border py-8 text-center text-sm text-muted-foreground">Ainda não há cartões de ID criados para este evento.</p>}
      </section>
    </div>
  );
}
