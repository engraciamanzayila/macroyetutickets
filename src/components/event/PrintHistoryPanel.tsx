import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileClock, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllTickets, type Group } from "@/lib/generate";
import { exportForPrint } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type PrintJob = {
  id: string;
  file_name: string;
  storage_path: string | null;
  source_printed_at: string;
  ticket_count: number;
  page_count: number;
  counts: Record<string, number>;
};
const timestampKey = (value: string) => new Date(value).toISOString();

export function PrintHistoryPanel({
  eventId,
  eventName,
  groups,
}: {
  eventId: string;
  eventName: string;
  groups: Group[];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null,
  );
  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);

  const {
    data: jobs = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["print-history", eventId, groupIds],
    queryFn: async () => {
      const { data: archived, error: archiveError } = await supabase
        .from("print_jobs")
        .select("id,file_name,storage_path,source_printed_at,ticket_count,page_count")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (archiveError) throw archiveError;

      const tickets = await fetchAllTickets({ event_id: eventId });
      const rows: PrintJob[] = (archived ?? []).map((job) => ({
        ...job,
        counts: tickets
          .filter(
            (ticket) =>
              ticket.printed_at &&
              timestampKey(ticket.printed_at) === timestampKey(job.source_printed_at),
          )
          .reduce<Record<string, number>>((counts, ticket) => {
            counts[ticket.group_id] = (counts[ticket.group_id] ?? 0) + 1;
            return counts;
          }, {}),
      }));
      const knownBatches = new Set(rows.map((job) => timestampKey(job.source_printed_at)));
      const legacy = new Map<string, Record<string, number>>();
      for (const ticket of tickets) {
        if (!ticket.printed_at || knownBatches.has(timestampKey(ticket.printed_at))) continue;
        const batchKey = timestampKey(ticket.printed_at);
        const counts = legacy.get(batchKey) ?? {};
        counts[ticket.group_id] = (counts[ticket.group_id] ?? 0) + 1;
        legacy.set(batchKey, counts);
      }
      for (const [printedAt, counts] of legacy) {
        rows.push({
          id: `legacy-${printedAt}`,
          file_name: `${eventName || "Evento"}_IMPRESSAO.pdf`,
          storage_path: null,
          source_printed_at: printedAt,
          ticket_count: Object.values(counts).reduce((sum, count) => sum + count, 0),
          page_count: 0,
          counts,
        });
      }
      return rows.sort((a, b) => b.source_printed_at.localeCompare(a.source_printed_at));
    },
  });

  const download = async (job: PrintJob) => {
    setBusy(job.id);
    try {
      if (job.storage_path) {
        const { data, error: fileError } = await supabase.storage
          .from("print-files")
          .download(job.storage_path);
        if (fileError || !data) throw fileError ?? new Error("PDF não encontrado no arquivo");
        const url = URL.createObjectURL(data);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = job.file_name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }

      const picks = groups.flatMap((group) => {
        const count = job.counts[group.id] ?? 0;
        return count ? [{ g: group, count }] : [];
      });
      if (!picks.length) throw new Error("Este lote não tem ingressos disponíveis para recuperar");
      setProgress({ done: 0, total: 1, label: "A reconstruir o PDF original…" });
      const result = await exportForPrint(
        picks,
        eventName,
        (done, total, label) => setProgress({ done, total, label }),
        eventId,
        job.source_printed_at,
      );
      toast.success(`${result.total} ingressos recuperados e arquivados neste evento.`);
      await qc.invalidateQueries({ queryKey: ["print-history", eventId] });
    } catch (caught) {
      toast.error("Não foi possível recuperar o PDF: " + (caught as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Arquivo de impressões</h2>
        <p className="text-sm text-muted-foreground">
          PDFs deste evento e recuperação dos lotes antigos a partir dos tickets marcados para
          impressão.
        </p>
      </header>
      {progress && (
        <div className="space-y-2">
          <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
          <p className="text-xs text-muted-foreground">{progress.label}</p>
        </div>
      )}
      {isLoading ? (
        <p className="py-6 text-sm text-muted-foreground">A carregar o histórico…</p>
      ) : error ? (
        <p className="py-6 text-sm text-destructive">
          Não foi possível carregar o arquivo: {(error as Error).message}
        </p>
      ) : jobs.length ? (
        <div className="divide-y border-y">
          {jobs.map((job) => (
            <div key={job.id} className="flex flex-wrap items-center gap-4 py-4">
              <FileClock className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-[220px] flex-1">
                <p className="font-medium">{job.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.source_printed_at).toLocaleString("pt-AO")} · {job.ticket_count}{" "}
                  ingresso(s)
                  {job.page_count ? ` · ${job.page_count} página(s)` : ""}
                  {job.storage_path ? " · arquivado" : " · PDF antigo, será reconstruído"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {groups
                    .filter((group) => job.counts[group.id])
                    .map((group) => `${group.name}: ${job.counts[group.id]}`)
                    .join(" · ")}
                </p>
              </div>
              <Button
                variant={job.storage_path ? "secondary" : "default"}
                disabled={!!busy}
                onClick={() => void download(job)}
              >
                {job.storage_path ? (
                  <Download className="h-4 w-4" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                {busy === job.id
                  ? "A preparar…"
                  : job.storage_path
                    ? "Baixar PDF"
                    : "Recuperar PDF"}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="border-y py-8 text-center text-sm text-muted-foreground">
          Ainda não há ingressos enviados para impressão neste evento.
        </p>
      )}
    </div>
  );
}
