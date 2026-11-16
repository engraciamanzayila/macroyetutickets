import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Download, Mail, MessageCircle, Search } from "lucide-react";
import { getShare, markSent } from "@/lib/shares.functions";
import { downloadPdf, holderLink, type RenderGroup } from "@/lib/share-render";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/p/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Portal do parceiro — MY Tickets" },
      { name: "description", content: "Gira e envie os ingressos atribuídos à sua entidade." },
      { property: "og:title", content: "Portal do parceiro — MY Tickets" },
      { property: "og:description", content: "Gira e envie os ingressos atribuídos à sua entidade." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PartnerPortal,
});

const VIA: Record<string, string> = { whatsapp: "WhatsApp", email: "E-mail", link: "Link", download: "Baixado" };

function PartnerPortal() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ["share", token], queryFn: () => getShare({ data: { token } }), retry: false });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "todo" | "sent" | "used">("todo");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);

  const tickets = data?.tickets ?? [];
  const shown = useMemo(() => tickets.filter((t) =>
    (filter === "all" || (filter === "todo" && !t.sent_at && t.status !== "used") || (filter === "sent" && t.sent_at) || (filter === "used" && t.status === "used")) &&
    (!q || t.code.includes(q.toUpperCase()) || (t.holder_name ?? "").toLowerCase().includes(q.toLowerCase()))), [tickets, filter, q]);

  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground">A carregar…</div>;
  if (error || !data) return <div className="min-h-screen grid place-items-center px-4 text-center"><div className="space-y-3"><Logo /><p>{(error as Error)?.message ?? "Link inválido"}</p></div></div>;

  const picked = tickets.filter((t) => sel.has(t.id));
  const g = data.group as unknown as RenderGroup;
  const stats = { total: tickets.length, sent: tickets.filter((t) => t.sent_at).length, used: tickets.filter((t) => t.status === "used").length };

  const record = async (via: string) => {
    await markSent({ data: { token, ids: picked.map((t) => t.id), via, name, contact } });
    qc.invalidateQueries({ queryKey: ["share", token] });
    setSel(new Set());
  };
  const message = () => {
    const link = holderLink(picked.map((t) => t.share_token));
    return `Olá${name ? " " + name : ""}! ${picked.length > 1 ? `Aqui estão os seus ${picked.length} ingressos` : "Aqui está o seu ingresso"} para ${data.event?.name}${data.event?.event_date ? " (" + data.event.event_date + ")" : ""}, oferta de ${data.share.partner_name}:\n${link}\n\nApresente o QR code à entrada. Ingresso pessoal e intransmissível.`;
  };
  const act = async (via: "whatsapp" | "email" | "link" | "download") => {
    if (!picked.length) return toast.error("Selecione pelo menos um ingresso");
    setBusy(true);
    try {
      if (via === "whatsapp") {
        const phone = contact.replace(/\D/g, "");
        const num = phone && phone.length === 9 ? "244" + phone : phone;
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(message())}`, "_blank");
      } else if (via === "email") {
        window.location.href = `mailto:${contact.includes("@") ? contact : ""}?subject=${encodeURIComponent("Ingresso — " + (data.event?.name ?? ""))}&body=${encodeURIComponent(message())}`;
      } else if (via === "link") {
        await navigator.clipboard.writeText(message());
        toast.success("Mensagem com link copiada");
      } else {
        await downloadPdf(picked.map((t) => ({ g, code: t.code, holderName: name || t.holder_name })), `${data.event?.name}_${data.share.partner_name}`);
      }
      await record(via);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b"><div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between"><Logo /><Badge variant="secondary">{data.share.partner_kind}</Badge></div></header>
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6 pb-40">
        <div>
          <p className="text-sm text-muted-foreground">Portal de {data.share.partner_name}</p>
          <h1 className="text-3xl font-bold">{data.event?.name}</h1>
          <p className="text-sm text-muted-foreground">{data.group?.name} · {data.group?.ticket_type}{data.event?.venue ? ` · ${data.event.venue}` : ""}{data.event?.event_date ? ` · ${data.event.event_date}` : ""}</p>
          {data.share.note && <p className="mt-2 text-sm">{data.share.note}</p>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[["Atribuídos", stats.total], ["Enviados", stats.sent], ["Já entraram", stats.used]].map(([l, v]) => (
            <div key={l} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-2xl font-bold">{v}</p></div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {([["todo", "Por enviar"], ["sent", "Enviados"], ["used", "Entraram"], ["all", "Todos"]] as const).map(([v, l]) => (
            <Button key={v} size="sm" variant={filter === v ? "default" : "secondary"} onClick={() => setFilter(v)}>{l}</Button>
          ))}
          <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código ou nome…" className="pl-9" /></div>
        </div>

        <div className="rounded-2xl border bg-card divide-y">
          <label className="flex items-center gap-3 p-3 text-sm">
            <Checkbox checked={shown.length > 0 && shown.every((t) => sel.has(t.id))} onCheckedChange={(v) => setSel(v ? new Set(shown.map((t) => t.id)) : new Set())} />
            Selecionar todos ({shown.length})
            <span className="ml-auto text-muted-foreground">Selecionar os primeiros</span>
            <Input type="number" min={1} max={shown.length} placeholder="Qtd" className="h-8 w-20" onChange={(e) => { const n = parseInt(e.target.value) || 0; setSel(new Set(shown.slice(0, n).map((t) => t.id))); }} />
          </label>
          {shown.map((t) => (
            <label key={t.id} className="flex flex-wrap items-center gap-3 p-3 text-sm cursor-pointer">
              <Checkbox checked={sel.has(t.id)} onCheckedChange={(v) => { const s = new Set(sel); v ? s.add(t.id) : s.delete(t.id); setSel(s); }} />
              <span className="text-muted-foreground w-10">#{t.seq}</span>
              <span className="font-mono">{t.code}</span>
              <span className="flex-1 truncate">{t.holder_name}{t.holder_contact ? ` · ${t.holder_contact}` : ""}</span>
              {t.status === "used" ? <Badge>Entrou</Badge> : t.sent_at ? <Badge variant="secondary">{VIA[t.sent_via ?? ""] ?? "Enviado"}</Badge> : <Badge variant="outline">Por enviar</Badge>}
            </label>
          ))}
          {!shown.length && <p className="p-6 text-center text-sm text-muted-foreground">Nada aqui.</p>}
        </div>
      </main>

      <div className="fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do convidado (opcional)" />
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Telefone ou e-mail" />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground mr-auto">{picked.length} selecionado(s)</span>
            <Button size="sm" disabled={busy} onClick={() => act("whatsapp")}><MessageCircle className="h-4 w-4" /> WhatsApp</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act("email")}><Mail className="h-4 w-4" /> E-mail</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act("link")}><Copy className="h-4 w-4" /> Copiar link</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act("download")}><Download className="h-4 w-4" /> Baixar PDF</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
