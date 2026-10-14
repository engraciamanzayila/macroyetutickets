import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { getHolderTickets } from "@/lib/shares.functions";
import { downloadPdf, ticketImage, type RenderGroup } from "@/lib/share-render";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/i/$tokens")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "O seu ingresso — MACRO YETU TICKETs" },
      { name: "description", content: "Ingresso digital com QR code. Apresente-o à entrada do evento." },
      { property: "og:title", content: "O seu ingresso — MACRO YETU TICKETs" },
      { property: "og:description", content: "Ingresso digital com QR code. Apresente-o à entrada do evento." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HolderPage,
});

function TicketImg({ g, code, holderName }: { g: RenderGroup; code: string; holderName?: string | null }) {
  const [src, setSrc] = useState("");
  useEffect(() => { ticketImage(g, code, holderName).then((c) => setSrc(c.toDataURL("image/jpeg", 0.9))); }, [g, code, holderName]);
  return src ? <img src={src} alt={`Ingresso ${code}`} className="w-full rounded-xl border" /> : <div className="aspect-[3/1] rounded-xl border animate-pulse bg-muted" />;
}

function HolderPage() {
  const { tokens } = Route.useParams();
  const list = tokens.split(",");
  const { data, error, isLoading } = useQuery({ queryKey: ["holder", tokens], queryFn: () => getHolderTickets({ data: { tokens: list } }), retry: false });
  const [busy, setBusy] = useState(false);
  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground">A carregar…</div>;
  if (error || !data) return <div className="min-h-screen grid place-items-center px-4 text-center"><div className="space-y-3"><Logo /><p>{(error as Error)?.message ?? "Link inválido"}</p></div></div>;
  const gOf = (id: string) => data.groups.find((g) => g.id === id) as unknown as RenderGroup;

  return (
    <div className="min-h-screen">
      <header className="border-b"><div className="mx-auto max-w-3xl px-4 h-16 flex items-center"><Logo /></div></header>
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{data.event?.name}</h1>
          <p className="text-sm text-muted-foreground">{[data.event?.event_date, data.event?.event_time, data.event?.venue, data.event?.city].filter(Boolean).join(" · ")}</p>
        </div>
        <Button disabled={busy} onClick={async () => { setBusy(true); try { await downloadPdf(data.tickets.map((t) => ({ g: gOf(t.group_id), code: t.code, holderName: t.holder_name })), `${data.event?.name}_ingressos`); } finally { setBusy(false); } }}>
          <Download className="h-4 w-4" /> {busy ? "A preparar…" : `Baixar ${data.tickets.length > 1 ? `os ${data.tickets.length} ingressos` : "ingresso"} (PDF)`}
        </Button>
        <div className="space-y-4">
          {data.tickets.map((t) => (
            <div key={t.code} className="space-y-1">
              <TicketImg g={gOf(t.group_id)} code={t.code} holderName={t.holder_name} />
              <p className="text-xs text-muted-foreground">{t.status === "used" ? "Já utilizado" : "Válido"} · {t.code}{t.holder_name ? ` · ${t.holder_name}` : ""}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Ingresso pessoal e intransmissível. Cada QR code só permite uma entrada.</p>
      </main>
    </div>
  );
}
