import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { getHolderTickets } from "@/lib/shares.functions";
import { downloadPdf, type RenderGroup } from "@/lib/share-render";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/i/$tokens")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Gerir e descarregar ingressos — MY Tickets" },
      { name: "description", content: "Consulte e descarregue os seus ingressos digitais." },
      { property: "og:title", content: "Descarregar ingressos — MY Tickets" },
      { property: "og:description", content: "Descarregue os seus ingressos em PDF." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HolderPage,
});

function HolderPage() {
  const { tokens } = Route.useParams();
  const list = tokens.split(",");
  const { data, error, isLoading } = useQuery({
    queryKey: ["holder", tokens],
    queryFn: () => getHolderTickets({ data: { tokens: list } }),
    retry: false,
  });
  const [busy, setBusy] = useState(false);

  if (isLoading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">A preparar os seus PDFs…</div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen grid place-items-center px-4 text-center">
        <div className="space-y-3"><Logo /><p>{(error as Error)?.message ?? "Link de download inválido ou expirado."}</p></div>
      </div>
    );
  }

  const gOf = (id: string) => data.groups.find((group) => group.id === id) as unknown as RenderGroup;
  const download = async () => {
    setBusy(true);
    try {
      await downloadPdf(
        data.tickets.map((ticket) => ({
          g: gOf(ticket.group_id),
          code: ticket.code,
          holderName: ticket.holder_name,
        })),
        `${data.event?.name ?? "MY_Tickets"}_ingressos`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto max-w-xl px-4 h-16 flex items-center"><Logo /></div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-2xl border bg-card p-6 sm:p-8 space-y-5 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-muted">
            <Download className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Os seus ingressos</h1>
            <p className="text-muted-foreground">{data.event?.name}</p>
            <p className="text-sm text-muted-foreground">
              {data.tickets.length} PDF(s) disponível(is) para descarregar.
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border text-left divide-y">
            {data.tickets.map((ticket) => {
              const group = data.groups.find((item) => item.id === ticket.group_id);
              return (
                <div key={ticket.code} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">{ticket.code}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ticket.holder_name || "Titular não indicado"} · {group?.name ?? "Ingresso"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ticket.status === "used" ? "Utilizado" : "Válido"}
                  </span>
                </div>
              );
            })}
          </div>
          <Button className="w-full" size="lg" disabled={busy} onClick={() => void download()}>
            <Download className="h-4 w-4" />
            {busy ? "A preparar os PDFs…" : "Descarregar todos em PDF"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Guarde os seus ingressos e apresente o QR Code individual de cada um à entrada.
          </p>
        </div>
      </main>
    </div>
  );
}
