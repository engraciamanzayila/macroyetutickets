import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllTickets, type Group } from "@/lib/generate";
import { Button } from "@/components/ui/button";

export function ReportPanel({ eventId, eventName, groups }: { eventId: string; eventName: string; groups: Group[] }) {
  const qc = useQueryClient();
  const { data: tickets = [] } = useQuery({
    queryKey: ["report", eventId],
    queryFn: () => fetchAllTickets({ event_id: eventId }),
  });

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const ch = supabase
      .channel(`report-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `event_id=eq.${eventId}` }, () => {
        clearTimeout(t);
        t = setTimeout(() => qc.invalidateQueries({ queryKey: ["report", eventId] }), 800);
      })
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [eventId, qc]);

  const count = (list: typeof tickets) => ({
    total: list.length,
    used: list.filter((t) => t.status === "used").length,
    void: list.filter((t) => t.status === "void").length,
  });
  const all = count(tickets);
  const byGroup = groups.map((g) => ({ g, ...count(tickets.filter((t) => t.group_id === g.id)) }));
  const types = [...new Set(groups.map((g) => g.ticket_type))];
  const byType = types.map((type) => ({ type, ...count(tickets.filter((t) => groups.find((g) => g.id === t.group_id)?.ticket_type === type)) }));

  const exportCsv = () => {
    const rows = [["Código", "Nº", "Grupo", "Tipo", "Destinatário", "Estado", "Entrada"]];
    for (const t of tickets) {
      const g = groups.find((x) => x.id === t.group_id);
      rows.push([t.code, String(t.seq), g?.name ?? "", g?.ticket_type ?? "", g?.recipient ?? "", { valid: "Por usar", used: "Entrou", void: "Anulado" }[t.status] ?? t.status, t.used_at ? new Date(t.used_at).toLocaleString("pt-PT") : ""]);
    }
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${eventName || "evento"}_relatorio.csv`;
    a.click();
  };

  const Bar = ({ used, total }: { used: number; total: number }) => (
    <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-brand" style={{ width: `${total ? (used / total) * 100 : 0}%` }} /></div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success animate-pulse" /> Atualiza ao vivo</p>
        <Button variant="secondary" onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" /> Exportar Excel (CSV)</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Emitidos", all.total - all.void],
          ["Entraram", all.used],
          ["Por entrar", all.total - all.used - all.void],
          ["Anulados", all.void],
        ].map(([l, v]) => (
          <div key={l} className="rounded-2xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">{l}</p>
            <p className="text-4xl font-display font-extrabold mt-1">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <h3 className="font-bold">Por tipo / área</h3>
          {byType.map((r) => (
            <div key={r.type} className="space-y-1">
              <div className="flex justify-between text-sm"><span>{r.type}</span><span className="text-muted-foreground">{r.used} / {r.total - r.void}</span></div>
              <Bar used={r.used} total={r.total - r.void} />
            </div>
          ))}
        </div>
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <h3 className="font-bold">Por grupo</h3>
          {byGroup.map((r) => (
            <div key={r.g.id} className="space-y-1">
              <div className="flex justify-between text-sm gap-2"><span className="truncate">{r.g.name}{r.g.recipient ? ` → ${r.g.recipient}` : ""}</span><span className="text-muted-foreground shrink-0">{r.used} / {r.total - r.void}</span></div>
              <Bar used={r.used} total={r.total - r.void} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
