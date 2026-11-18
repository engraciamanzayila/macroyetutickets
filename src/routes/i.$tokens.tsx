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
      { title: "Descarregar ingressos — MY Tickets" },
      { name: "description", content: "Descarregue os seus ingressos em PDF." },
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
            <h1 className="text-2xl font-bold">Os seus ingressos estão prontos</h1>
            <p className="text-muted-foreground">{data.event?.name}</p>
            <p className="text-sm text-muted-foreground">
              {data.tickets.length} PDF(s) disponível(is) para descarregar.
            </p>
          </div>
          <Button className="w-full" size="lg" disabled={busy} onClick={() => void download()}>
            <Download className="h-4 w-4" />
            {busy ? "A preparar os PDFs…" : "Descarregar ingressos em PDF"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Este é apenas um link de download. Não dá acesso ao portal de gestão do parceiro.
          </p>
        </div>
      </main>
    </div>
  );
}
