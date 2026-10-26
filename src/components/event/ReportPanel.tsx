import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useState } from "react";
import { FileDown, FileSpreadsheet, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllTickets, type Group } from "@/lib/generate";
import { syncEventSheet } from "@/lib/sheets.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function ReportPanel({
  eventId,
  eventName,
  groups,
}: {
  eventId: string;
  eventName: string;
  groups: Group[];
}) {
  const qc = useQueryClient();
  const [openingSheet, setOpeningSheet] = useState(false);
  const { data: tickets = [] } = useQuery({
    queryKey: ["report", eventId],
    queryFn: () => fetchAllTickets({ event_id: eventId }),
  });

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const ch = supabase
      .channel(`report-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: `event_id=eq.${eventId}` },
        () => {
          clearTimeout(t);
          t = setTimeout(() => qc.invalidateQueries({ queryKey: ["report", eventId] }), 800);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [eventId, qc]);

  const count = (list: typeof tickets) => ({
    total: list.length,
    used: list.filter((t) => t.status === "used").length,
    void: list.filter((t) => t.status === "void").length,
  });
  const all = count(tickets);
  const byGroup = groups.map((g) => ({ g, ...count(tickets.filter((t) => t.group_id === g.id)) }));
  const types = [...new Set(groups.map((g) => g.ticket_type))];
  const byType = types.map((type) => ({
    type,
    ...count(tickets.filter((t) => groups.find((g) => g.id === t.group_id)?.ticket_type === type)),
  }));

  const exportCsv = () => {
    const rows = [["Código", "Nº", "Grupo", "Tipo", "Destinatário", "Estado", "Entrada"]];
    for (const t of tickets) {
      const g = groups.find((x) => x.id === t.group_id);
      rows.push([
        t.code,
        String(t.seq),
        g?.name ?? "",
        g?.ticket_type ?? "",
        g?.recipient ?? "",
        { valid: "Por usar", used: "Entrou", void: "Anulado" }[t.status] ?? t.status,
        t.used_at ? new Date(t.used_at).toLocaleString("pt-PT") : "",
      ]);
    }
    const csv =
      "\uFEFF" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${eventName || "evento"}_relatorio.csv`;
    a.click();
  };

  const exportPdf = async () => {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const pdf = new jsPDF({ orientation: "landscape", format: "a4" });
    const rows = byGroup.map(({ g, total, used, void: voidCount }) => {
      const groupTickets = tickets.filter((ticket) => ticket.group_id === g.id);
      const printed = groupTickets.filter((ticket) => ticket.printed_at).length;
      return [
        g.name,
        g.ticket_type,
        g.recipient ?? "",
        String(total),
        String(printed),
        String(total - printed),
        String(total - used - voidCount),
        String(used),
        String(voidCount),
      ];
    });
    pdf.setFontSize(18);
    pdf.text(`Relatório de ingressos — ${eventName}`, 14, 18);
    pdf.setFontSize(10);
    pdf.text(`Gerado em ${new Date().toLocaleString("pt-AO")}`, 14, 25);
    pdf.text(
      `Emitidos: ${all.total - all.void}   Entraram: ${all.used}   Por entrar: ${all.total - all.used - all.void}   Anulados: ${all.void}`,
      14,
      32,
    );
    autoTable(pdf, {
      startY: 38,
      head: [
        [
          "Grupo",
          "Tipo",
          "Destinatário",
          "Total",
          "Impressos",
          "Digitais",
          "Por entrar",
          "Entraram",
          "Anulados",
        ],
      ],
      body: rows,
      styles: { fontSize: 8 },
    });
    const lastY =
      (pdf as typeof pdf & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 38;
    autoTable(pdf, {
      startY: lastY + 8,
      head: [["Código", "Nº", "Grupo", "Tipo", "Destinatário", "Canal", "Estado", "Entrada"]],
      body: tickets.map((t) => {
        const g = groups.find((item) => item.id === t.group_id);
        return [
          t.code,
          String(t.seq),
          g?.name ?? "",
          g?.ticket_type ?? "",
          g?.recipient ?? "",
          t.printed_at ? "Impresso" : "Digital",
          { valid: "Por usar", used: "Entrou", void: "Anulado" }[t.status] ?? t.status,
          t.used_at ? new Date(t.used_at).toLocaleString("pt-AO") : "",
        ];
      }),
      styles: { fontSize: 7 },
      didDrawPage: () => {
        pdf.setFontSize(8);
        pdf.text(`MACRO YETU TICKETs · ${eventName}`, 14, pdf.internal.pageSize.getHeight() - 7);
      },
    });
    pdf.save(`${eventName || "evento"}_relatorio.pdf`);
  };

  const openSheet = async () => {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setOpeningSheet(true);
    try {
      const { url } = await syncEventSheet({ data: { eventId } });
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error("Não foi possível abrir a folha: " + (e as Error).message);
    } finally {
      setOpeningSheet(false);
    }
  };

  const Bar = ({ used, total }: { used: number; total: number }) => (
    <div className="h-2 rounded-full bg-secondary overflow-hidden">
      <div className="h-full bg-brand" style={{ width: `${total ? (used / total) * 100 : 0}%` }} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" /> Atualiza ao vivo
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openSheet} disabled={openingSheet}>
            <ExternalLink className="h-4 w-4" />{" "}
            {openingSheet ? "A atualizar…" : "Abrir Google Sheets"}
          </Button>
          <Button variant="secondary" onClick={() => void exportPdf()}>
            <FileDown className="h-4 w-4" /> Relatório PDF
          </Button>
          <Button variant="ghost" onClick={exportCsv}>
            <FileSpreadsheet className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>
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
              <div className="flex justify-between text-sm">
                <span>{r.type}</span>
                <span className="text-muted-foreground">
                  {r.used} / {r.total - r.void}
                </span>
              </div>
              <Bar used={r.used} total={r.total - r.void} />
            </div>
          ))}
        </div>
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <h3 className="font-bold">Por grupo</h3>
          {byGroup.map((r) => (
            <div key={r.g.id} className="space-y-1">
              <div className="flex justify-between text-sm gap-2">
                <span className="truncate">
                  {r.g.name}
                  {r.g.recipient ? ` → ${r.g.recipient}` : ""}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {r.used} / {r.total - r.void}
                </span>
              </div>
              <Bar used={r.used} total={r.total - r.void} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
