import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ensureTickets, fetchAllTickets, type Group, type TicketRow } from "@/lib/generate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function TablesPanel({ eventId, groups }: { eventId: string; groups: Group[] }) {
  const qc = useQueryClient();
  const tableGroups = useMemo(
    () => groups.filter((group) => group.ticket_type.toUpperCase().includes("MESA")),
    [groups],
  );
  const [groupId, setGroupId] = useState(tableGroups[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
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
            {currentTickets.length < group.quantity && (
              <Button onClick={generateMissing} disabled={generating}>
                {generating ? "A gerar…" : "Gerar códigos em falta"}
              </Button>
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
    </div>
  );
}
