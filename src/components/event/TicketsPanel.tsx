import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, Download, Mail, MessageCircle, RotateCcw, Search, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { artUrl, type Group } from "@/lib/generate";
import { sendTicketEmail } from "@/lib/order-email.functions";
import { holderLink, downloadPdf, type RenderGroup } from "@/lib/share-render";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./StatusBadge";

export function TicketsPanel({ eventId, eventName, groups }: { eventId: string; eventName: string; groups: Group[] }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const voidMany = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from("tickets").update({ status: "void" }).in("id", ids.slice(i, i + 200)).neq("status", "used");
      if (error) return toast.error(error.message);
    }
    toast.success(`${ids.length} ingresso(s) anulados (os que já entraram não são alterados).`);
    setPicked(new Set());
    qc.invalidateQueries({ queryKey: ["tickets", eventId] });
  };
  const voidGroup = async () => {
    const g = groups.find((x) => x.id === group);
    if (!g || !confirm(`Anular TODOS os ingressos por usar do grupo "${g.name}"?`)) return;
    const { error } = await supabase.from("tickets").update({ status: "void" }).eq("group_id", g.id).eq("status", "valid");
    if (error) return toast.error(error.message);
    toast.success("Grupo anulado.");
    qc.invalidateQueries({ queryKey: ["tickets", eventId] });
  };
  const { data = [], isLoading } = useQuery({
    queryKey: ["tickets", eventId, q, group, status],
    queryFn: async () => {
      let query = supabase.from("tickets").select("id,code,seq,status,used_at,group_id,share_token").eq("event_id", eventId).order("seq").limit(200);
      if (q) query = query.ilike("code", `%${q.trim().toUpperCase()}%`);
      if (group) query = query.eq("group_id", group);
      if (status) query = query.eq("status", status);
      return (await query).data ?? [];
    },
  });
  const gname = (id: string) => groups.find((g) => g.id === id)?.name ?? "";

  const shareTicket = async (ticket: { id: string; code: string; group_id: string; share_token: string | null }, via: "whatsapp" | "email" | "link" | "download") => {
    try {
      const ticketGroup = groups.find((g) => g.id === ticket.group_id);
      if (!ticketGroup) throw new Error("Grupo não encontrado");
      if (!ticket.share_token) throw new Error("Este ingresso não tem um link seguro disponível");
      const ticketLink = holderLink([ticket.share_token]);
      const text = `Olá! Aqui está o seu ingresso para ${eventName}: ${ticketLink}\nApresente o QR code ou a referência à entrada.`;

      if (via === "link") {
        await navigator.clipboard.writeText(ticketLink);
        toast.success("Link do ingresso copiado");
        return;
      }

      if (via === "download") {
        const art = await artUrl(ticketGroup.art_path ?? "");
        if (!art) throw new Error("Este grupo ainda não tem arte disponível");
        const renderGroup: RenderGroup = { ...ticketGroup, art_url: art, layout: ticketGroup.layout };
        await downloadPdf(
          [{ g: renderGroup, code: ticket.code }],
          `${eventName}_${ticket.code}`,
        );
        return;
      }

      const contact = window.prompt(
        via === "whatsapp" ? "Número do WhatsApp do destinatário:" : "E-mail do destinatário:",
        "",
      )?.trim();
      if (!contact) return;

      if (via === "whatsapp") {
        const digits = contact.replace(/\D/g, "");
        if (!digits) return toast.error("Indique um número de WhatsApp válido");
        const phone = digits.length === 9 ? `244${digits}` : digits;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
        return;
      }

      if (!contact.includes("@")) return toast.error("Indique um e-mail válido");
      const result = await sendTicketEmail({
        data: { eventId, ticketIds: [ticket.id], recipient: contact },
      });
      if (result.status !== "sent") throw new Error("O Zoho não confirmou o envio");
      toast.success(`E-mail enviado a ${result.recipient}`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const setTicket = async (id: string, patch: { status: string; used_at?: null }) => {
    const { error } = await supabase.from("tickets").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tickets", eventId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar código…" className="pl-9 font-mono" />
        </div>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          <option value="" className="bg-popover">Todos os grupos</option>
          {groups.map((g) => <option key={g.id} value={g.id} className="bg-popover">{g.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          <option value="" className="bg-popover">Todos os estados</option>
          <option value="valid" className="bg-popover">Por usar</option>
          <option value="used" className="bg-popover">Entrou</option>
          <option value="void" className="bg-popover">Anulado</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={data.length > 0 && data.every((t) => picked.has(t.id))}
            onCheckedChange={(v) => setPicked(v ? new Set(data.filter((t) => t.status !== "used").map((t) => t.id)) : new Set())}
          />
          Selecionar todos os visíveis
        </label>
        <Button size="sm" variant="destructive" disabled={!picked.size} onClick={() => confirm(`Anular ${picked.size} ingresso(s)?`) && voidMany([...picked])}>
          <Ban className="h-4 w-4" /> Anular selecionados ({picked.size})
        </Button>
        {group && <Button size="sm" variant="outline" className="text-destructive" onClick={voidGroup}><Ban className="h-4 w-4" /> Anular grupo inteiro</Button>}
      </div>
      <div className="rounded-2xl border bg-card divide-y">
        {isLoading ? <p className="p-6 text-muted-foreground">A carregar…</p> : data.length === 0 ? <p className="p-6 text-muted-foreground">Nenhum ingresso. Gere ingressos no separador “Grupos”.</p> :
          data.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Checkbox
                aria-label={`Selecionar ${t.code}`}
                disabled={t.status === "used"}
                checked={picked.has(t.id)}
                onCheckedChange={(v) => setPicked((prev) => { const n = new Set(prev); if (v) n.add(t.id); else n.delete(t.id); return n; })}
              />
              <span className="font-mono font-bold w-44">{t.code}</span>
              <span className="text-sm text-muted-foreground flex-1 truncate">#{t.seq} · {gname(t.group_id)}</span>
              {t.used_at && <span className="text-xs text-muted-foreground">{new Date(t.used_at).toLocaleString("pt-PT")}</span>}
              <StatusBadge status={t.status} />
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" title="WhatsApp" onClick={() => void shareTicket(t, "whatsapp")}><MessageCircle className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" title="E-mail" onClick={() => void shareTicket(t, "email")}><Mail className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" title="Copiar link" onClick={() => void shareTicket(t, "link")}><Link2 className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" title="Baixar PDF" onClick={() => void shareTicket(t, "download")}><Download className="h-4 w-4" /></Button>
              </div>
              {t.status === "void" ? (
                <Button size="sm" variant="ghost" onClick={() => setTicket(t.id, { status: "valid" })}><RotateCcw className="h-4 w-4" /> Reativar</Button>
              ) : (
                <>
                  {t.status === "used" && <Button size="sm" variant="ghost" onClick={() => setTicket(t.id, { status: "valid", used_at: null })}><RotateCcw className="h-4 w-4" /> Repor</Button>}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm(`Anular ${t.code}?`) && setTicket(t.id, { status: "void" })}><Ban className="h-4 w-4" /> Anular</Button>
                </>
              )}
            </div>
          ))}
      </div>
      {data.length === 200 && <p className="text-xs text-muted-foreground">A mostrar os primeiros 200. Use a pesquisa para filtrar.</p>}
    </div>
  );
}
