import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Plus, Unlink, QrCode, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Group } from "@/lib/generate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type TableCard = {
  id: string;
  event_id: string;
  group_id: string;
  card_type: "MESA" | "BOX";
  card_number: number;
  holder_name: string | null;
  capacity: number;
  physical_identifier_type: "MESA" | "BOX" | null;
  physical_identifier_number: number | null;
  qr_token: string;
  status: "valid" | "void";
  created_at: string;
};

const db = supabase as any;

function cardTypeFor(group?: Group): "MESA" | "BOX" {
  if (!group) return "MESA";
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
      g.name.toUpperCase().includes("MESA") ||
      Number(g.price ?? 0) === 1_000_000
    ),
    [groups],
  );
  const [groupId, setGroupId] = useState("");
  const [holder, setHolder] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const activeGroup = eligibleGroups.find((g) => g.id === groupId) ?? eligibleGroups[0];
  const activeType = cardTypeFor(activeGroup);

  const { data: cards = [], isLoading, error } = useQuery<TableCard[]>({
    queryKey: ["event-table-id-cards", eventId],
    queryFn: async () => {
      const { data, error } = await db.from("event_table_cards")
        .select("*").eq("event_id", eventId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TableCard[];
    },
  });

  const assigned = useMemo(() => new Set(
    cards.filter((c) => c.physical_identifier_type && c.physical_identifier_number)
      .map((c) => `${c.physical_identifier_type}:${c.physical_identifier_number}`)
  ), [cards]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["event-table-id-cards", eventId] });
  };

  const createCard = async () => {
    if (!activeGroup || creating) return;
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1000) {
      toast.error("A capacidade deve ser um número inteiro entre 1 e 1000.");
      return;
    }
    setCreating(true);
    try {
      const groupCards = cards.filter((c) => c.group_id === activeGroup.id);
      const nextNumber = groupCards.reduce((max, c) => Math.max(max, c.card_number), 0) + 1;
      const { error } = await db.from("event_table_cards").insert({
        event_id: eventId,
        group_id: activeGroup.id,
        card_type: activeType,
        card_number: nextNumber,
        holder_name: holder.trim() || null,
        capacity: cap,
      });
      if (error) throw error;
      setHolder("");
      toast.success(`Cartão ${activeType} #${String(nextNumber).padStart(2, "0")} criado.`);
      await refresh();
    } catch (e) {
      toast.error("Não foi possível criar o cartão: " + (e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const synchronizeCards = async () => {
    if (syncing || !eligibleGroups.length) return;
    setSyncing(true);
    try {
      const targetMesa = eligibleGroups.filter((g) => cardTypeFor(g) === "MESA").reduce((n, g) => n + Number(g.quantity || 0), 0);
      const targetBox = eligibleGroups.filter((g) => cardTypeFor(g) === "BOX").reduce((n, g) => n + Number(g.quantity || 0), 0);
      if (targetMesa > 80 || targetBox > 20) throw new Error("Quantidade excede o inventário: MESA " + targetMesa + "/80; BOX " + targetBox + "/20.");
      const currentMesa = cards.filter((c) => c.card_type === "MESA").length;
      const currentBox = cards.filter((c) => c.card_type === "BOX").length;
      if (currentMesa > targetMesa || currentBox > targetBox) throw new Error("Já existem mais cartões do que a quantidade configurada. Reveja os cartões existentes; nenhum será apagado automaticamente.");
      const existingByGroup = new Map<string, TableCard[]>();
      cards.forEach((card) => existingByGroup.set(card.group_id, [...(existingByGroup.get(card.group_id) || []), card]));
      const rows = await Promise.all(eligibleGroups.map(async (g) => {
        const result = await db.from("tickets").select("seq,holder_name").eq("event_id", eventId).eq("group_id", g.id).order("seq");
        if (result.error) throw result.error;
        return { group: g, tickets: result.data || [] };
      }));
      let mesaNo = cards.filter((c) => c.card_type === "MESA").reduce((n, c) => Math.max(n, c.card_number), 0);
      let boxNo = cards.filter((c) => c.card_type === "BOX").reduce((n, c) => Math.max(n, c.card_number), 0);
      const inserts: Record<string, unknown>[] = [];
      for (const row of rows) {
        const existing = new Set((existingByGroup.get(row.group.id) || []).map((c) => c.card_number));
        const kind = cardTypeFor(row.group);
        for (let seq = 1; seq <= Number(row.group.quantity || 0); seq++) {
          if (existing.has(seq)) continue;
          const ticket = row.tickets.find((t: { seq: number }) => Number(t.seq) === seq);
          if (kind === "BOX") boxNo++; else mesaNo++;
          inserts.push({ event_id: eventId, group_id: row.group.id, card_type: kind, card_number: kind === "BOX" ? boxNo : mesaNo, holder_name: ticket?.holder_name?.trim() || null, capacity: 10 });
        }
      }
      if (inserts.length) { const result = await db.from("event_table_cards").insert(inserts); if (result.error) throw result.error; }
      await refresh();
      toast.success(inserts.length ? inserts.length + " cartão(ões) criados; nomes existentes importados." : "Cartões já sincronizados com as quantidades configuradas.");
    } catch (e) { toast.error("Falha na sincronização: " + (e as Error).message); }
    finally { setSyncing(false); }
  };
  const saveHolder = async (card: TableCard, value: string) => {
    const { error } = await db.from("event_table_cards")
      .update({ holder_name: value.trim() || null }).eq("id", card.id).eq("event_id", eventId);
    if (error) return toast.error("Não foi possível guardar o responsável: " + error.message);
    await refresh();
  };

  const saveCapacity = async (card: TableCard, value: string) => {
    const cap = Number(value);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1000)
      return toast.error("Capacidade inválida. Use um número entre 1 e 1000.");
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
          <div><h3 className="font-semibold">Sincronizar quantidade de cartões</h3><p className="text-sm text-muted-foreground">A quantidade vem dos grupos de mesas do evento. Nomes já associados aos ingressos são importados automaticamente; os restantes ficam em branco para preenchimento manual.</p></div>
          <Button onClick={() => void synchronizeCards()} disabled={syncing || isLoading || !eligibleGroups.length}><RefreshCw className="h-4 w-4" />{syncing ? "A sincronizar…" : "Sincronizar cartões"}</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <div className="rounded-lg bg-muted p-3"><p className="text-muted-foreground">MESA · máximo 80</p><p className="font-semibold">{cards.filter((c) => c.card_type === "MESA").length} cartões / {eligibleGroups.filter((g) => cardTypeFor(g) === "MESA").reduce((n, g) => n + Number(g.quantity || 0), 0)} configurados</p></div>
          <div className="rounded-lg bg-muted p-3"><p className="text-muted-foreground">BOX · máximo 20 · 1.000.000 Kz</p><p className="font-semibold">{cards.filter((c) => c.card_type === "BOX").length} cartões / {eligibleGroups.filter((g) => cardTypeFor(g) === "BOX").reduce((n, g) => n + Number(g.quantity || 0), 0)} configurados</p></div>
        </div>
        <p className="text-xs text-muted-foreground">A sincronização não apaga cartões existentes. Antes de imprimir, a quantidade criada deve coincidir com a configurada e cada cartão deve ter identificador físico associado.</p>
      </section>
      <section className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Criar cartão de ID</h3>
          <Badge variant={activeType === "BOX" ? "default" : "secondary"}>
            {activeType === "BOX" ? "BOX · 1.000.000 Kz" : "MESA"}
          </Badge>
        </div>
        {eligibleGroups.length ? <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Categoria / grupo do evento</span>
              <select value={activeGroup?.id ?? ""} onChange={(e) => setGroupId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3">
                {eligibleGroups.map((g) => <option key={g.id} value={g.id}>
                  {g.name} · {Number(g.price ?? 0).toLocaleString("pt-AO")} Kz
                </option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Responsável (opcional)</span>
              <Input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Nome do responsável" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Capacidade de pessoas</span>
              <Input type="number" min="1" max="1000" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {activeType === "BOX"
              ? "O grupo de 1.000.000 Kz gera cartões BOX. A associação física ficará limitada aos identificadores BOX 01–20."
              : "Esta categoria gera cartões MESA. A associação física ficará limitada aos identificadores MESA 01–80."}
          </p>
          <Button onClick={() => void createCard()} disabled={!activeGroup || creating}>
            <Plus className="h-4 w-4" /> {creating ? "A criar…" : "Criar cartão"}
          </Button>
        </> : <p className="text-sm text-muted-foreground">
          Ainda não existem grupos de mesas ou BOX neste evento. Crie primeiro os grupos nas configurações do evento.
        </p>}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Cartões criados</h3>
          <div className="flex gap-2 text-xs">
            <Badge variant="secondary">{cards.length} cartões</Badge>
            <Badge variant="outline">{cards.filter((c) => c.physical_identifier_type).length} identificadores associados</Badge>
          </div>
        </div>
        {isLoading ? <p className="py-6 text-sm text-muted-foreground">A carregar cartões…</p> :
         error ? <p className="py-6 text-sm text-destructive">Erro ao carregar cartões: {(error as Error).message}</p> :
         cards.length ? <div className="divide-y rounded-xl border">
          {cards.map((card) => {
            const group = groups.find((g) => g.id === card.group_id);
            const assignedValue = card.physical_identifier_type && card.physical_identifier_number
              ? `${card.physical_identifier_type}:${card.physical_identifier_number}` : "";
            const max = card.card_type === "BOX" ? 20 : 80;
            return <article key={card.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(170px,1fr)_minmax(180px,1fr)_minmax(190px,1fr)_auto] lg:items-center">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={card.card_type === "BOX" ? "default" : "secondary"}>{card.card_type}</Badge>
                  <span className="font-mono font-semibold">#{String(card.card_number).padStart(2, "0")}</span>
                </div>
                <p className="text-sm font-medium">{group?.name ?? "Categoria"}</p>
                <p className="text-xs text-muted-foreground">{group ? Number(group.price ?? 0).toLocaleString("pt-AO") + " Kz" : eventName}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 space-y-1 text-xs">
                  <span>Responsável</span>
                  <Input key={`${card.id}-holder-${card.holder_name}`} defaultValue={card.holder_name ?? ""}
                    placeholder="Nome" onBlur={(e) => {
                      if (e.currentTarget.value.trim() !== (card.holder_name ?? "")) void saveHolder(card, e.currentTarget.value);
                    }} />
                </label>
                <label className="col-span-2 space-y-1 text-xs">
                  <span>Capacidade</span>
                  <Input key={`${card.id}-capacity-${card.capacity}`} type="number" min="1" max="1000" defaultValue={card.capacity}
                    onBlur={(e) => {
                      if (Number(e.currentTarget.value) !== card.capacity) void saveCapacity(card, e.currentTarget.value);
                    }} />
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
