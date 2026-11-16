import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/visao-geral")({
  head: () => ({
    meta: [
      { title: "Visão geral dos ingressos — MY Tickets" },
      { name: "description", content: "Controlo de todos os ingressos: planeados, gerados, impressos, entregues e entradas." },
      { property: "og:title", content: "Visão geral dos ingressos — MY Tickets" },
      { property: "og:description", content: "Controlo de todos os ingressos da plataforma." },
    ],
  }),
  component: Overview,
});

type Row = {
  event_id: string; event_name: string; event_date: string | null; group_id: string; group_name: string;
  ticket_type: string; planned: number; generated: number; printed: number; digital_sent: number;
  sold: number; used: number; voided: number;
};
const COLS = [
  ["planned", "Planeados"], ["generated", "Gerados"], ["printed", "Impressos"], ["digital_sent", "Enviados digital"],
  ["sold", "Vendidos"], ["used", "Entraram"], ["voided", "Anulados"],
] as const;

function Overview() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["ticket-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ticket_overview");
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  const rows = useMemo(() => data.filter((r) =>
    (!type || r.ticket_type === type) &&
    (!q || `${r.event_name} ${r.group_name}`.toLowerCase().includes(q.toLowerCase()))), [data, q, type]);
  const types = [...new Set(data.map((r) => r.ticket_type))];
  const sum = (k: (typeof COLS)[number][0], list: Row[]) => list.reduce((s, r) => s + Number(r[k]), 0);
  const events = [...new Map(rows.map((r) => [r.event_id, r])).values()];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-display font-extrabold">Visão geral dos ingressos</h1>
        <p className="text-muted-foreground text-sm">Todos os grupos, por evento, com o estado de cada ingresso.</p>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {COLS.map(([k, l]) => (
          <div key={k} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="text-2xl font-display font-extrabold">{sum(k, rows).toLocaleString("pt-AO")}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar evento ou grupo…" className="max-w-xs" />
        <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Todos os tipos</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {isLoading ? <p className="text-muted-foreground">A carregar…</p> : error ? <p className="text-destructive text-sm">{(error as Error).message}</p> :
        events.length === 0 ? <p className="text-muted-foreground">Sem ingressos para mostrar.</p> : (
        <div className="space-y-6">
          {events.map((ev) => {
            const list = rows.filter((r) => r.event_id === ev.event_id);
            return (
              <section key={ev.event_id} className="rounded-2xl border bg-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b">
                  <Link to="/eventos/$eventId" params={{ eventId: ev.event_id }} className="font-bold hover:text-primary">{ev.event_name}</Link>
                  <span className="text-xs text-muted-foreground">{ev.event_date ? new Date(ev.event_date).toLocaleDateString("pt-AO") : "Sem data"}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left px-4 py-2 font-medium">Grupo</th>
                        <th className="text-left px-2 py-2 font-medium">Tipo</th>
                        {COLS.map(([k, l]) => <th key={k} className="text-right px-2 py-2 font-medium">{l}</th>)}
                        <th className="text-right px-4 py-2 font-medium">Por entregar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const left = Number(r.generated) - Number(r.printed) - Number(r.digital_sent) - Number(r.sold) - Number(r.voided);
                        return (
                          <tr key={r.group_id} className="border-b last:border-0">
                            <td className="px-4 py-2 font-medium">{r.group_name}</td>
                            <td className="px-2 py-2 text-muted-foreground">{r.ticket_type}</td>
                            {COLS.map(([k]) => <td key={k} className="px-2 py-2 text-right tabular-nums">{Number(r[k])}</td>)}
                            <td className="px-4 py-2 text-right tabular-nums font-semibold text-primary">{Math.max(left, 0)}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-secondary/50 font-semibold">
                        <td className="px-4 py-2" colSpan={2}>Total</td>
                        {COLS.map(([k]) => <td key={k} className="px-2 py-2 text-right tabular-nums">{sum(k, list)}</td>)}
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
