import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Group } from "@/lib/generate";
import { a4Grid, exportForPrint, lastPrintSelection, printAvailability, type LastPrintSelection, type PrintAvail } from "@/lib/print";
import { physicalMm } from "@/lib/render";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

type Props = { open: boolean; onOpenChange: (o: boolean) => void; eventId: string; eventName: string; groups: Group[]; onDone: () => void };

export function PrintDialog({ open, onOpenChange, eventId, eventName, groups, onDone }: Props) {
  const [avail, setAvail] = useState<PrintAvail | null>(null);
  const [lastSelection, setLastSelection] = useState<LastPrintSelection | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setAvail(null); setLastSelection(null); setQty({});
    Promise.all([printAvailability(eventId, groups), lastPrintSelection(eventId, groups)])
      .then(([availability, selection]) => { setAvail(availability); setLastSelection(selection); })
      .catch((e) => toast.error(e.message));
  }, [open, eventId, groups]);

  const total = Object.values(qty).reduce((s, n) => s + (n || 0), 0);

  const run = async () => {
    const picks = groups.map((g) => ({ g, count: qty[g.id] || 0 })).filter((p) => p.count > 0);
    const noLayout = picks.filter((p) => !p.g.layout);
    if (noLayout.length) return toast.error(`Posicione o QR primeiro em: ${noLayout.map((p) => p.g.name).join(", ")}`);
    try {
      setProgress({ done: 0, total: 1, label: "A iniciar…" });
      const r = await exportForPrint(picks, eventName, (done, t, label) => setProgress({ done, total: t, label }), eventId);
      toast.success(`${r.total} ingressos em ${r.pages} folha(s) A4. Marcados como impressos.`);
      onDone(); onOpenChange(false);
    } catch (e) {
      toast.error("Falha: " + (e as Error).message);
    } finally { setProgress(null); }
  };

  const downloadLastSelection = async () => {
    if (!lastSelection) return;
    try {
      setProgress({ done: 0, total: 1, label: "A preparar a última seleção…" });
      const result = await exportForPrint(
        lastSelection.picks,
        eventName,
        (done, total, label) => setProgress({ done, total, label }),
        eventId,
        lastSelection.printedAt,
      );
      toast.success(`${result.total} ingressos da última seleção novamente em PDF.`);
      onDone();
    } catch (e) {
      toast.error("Falha ao reexportar: " + (e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !progress && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Exportar para impressão (A4)</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Escolha quantos ingressos de cada grupo vão para a gráfica. Sai um único PDF, por ordem de grupo e número. Os ingressos exportados ficam marcados como <b>impressos</b> e deixam de sair nos downloads digitais.
        </p>
        <div className="max-h-[50vh] overflow-y-auto divide-y rounded-lg border">
          {!avail ? <p className="p-4 text-sm text-muted-foreground">A contar…</p> : groups.map((g) => {
            const a = avail[g.id] ?? { printed: 0, available: 0 };
            const mm = physicalMm(g);
            const grid = a4Grid(mm.w, mm.h);
            return (
              <div key={g.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex-1 min-w-[180px]">
                  <p className="font-medium text-sm">{g.name} <span className="text-muted-foreground font-normal">· {g.ticket_type}</span></p>
                  <p className="text-xs text-muted-foreground">{a.printed} já impressos · {a.available} disponíveis · {grid.cols * grid.rows} por folha</p>
                </div>
                <Button size="sm" variant="ghost" disabled={!a.available} onClick={() => setQty({ ...qty, [g.id]: a.available })}>Todos</Button>
                <Input type="number" min={0} max={a.available} disabled={!a.available} value={qty[g.id] ?? ""} placeholder="0" className="h-8 w-24"
                  onChange={(e) => setQty({ ...qty, [g.id]: Math.min(a.available, Math.max(0, parseInt(e.target.value) || 0)) })} />
              </div>
            );
          })}
        </div>
        {progress && (
          <div className="space-y-2">
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
            <p className="text-xs text-muted-foreground">{progress.label}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          {lastSelection && (
            <Button variant="secondary" onClick={downloadLastSelection} disabled={!!progress}>
              Baixar última seleção novamente ({lastSelection.total})
            </Button>
          )}
          <Button onClick={run} disabled={!total || !!progress}>{progress ? "A exportar…" : `Exportar ${total} para impressão`}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
