import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, Download, Mail, MessageCircle, RotateCcw, Search, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { artUrl, type Group } from "@/lib/generate";
import { holderLink, downloadPdf } from "@/lib/share-render";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";

export function TicketsPanel({ eventId, eventName, groups }: { eventId: string; eventName: string; groups: Group[] }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
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
    const group = groups.find((g) => g.id === ticket.group_id);
    if (!group) return toast.error("Grupo não encontrado");
    const ticketLink = ticket.share_token ? holderLink([ticket.share_token]) : `${window.location.origin}/i/${ticket.id}`;
    const text = `Olá! Aqui está o seu ingresso para ${eventName}: ${ticketLink}\nApresente o QR code ou a referência à entrada.`;

    if (via === "link") {
      await navigator.clipboard.writeText(ticketLink);
      toast.success("Link do ingresso copiado");
      return;
    }

    if (via === "download") {
      const art = await artUrl(group.art_path ?? "");
      if (!art) throw new Error("Este grupo ainda não tem arte disponível");
      await downloadPdf([{ g: { ...group, art_url: art } as never, code: ticket.code, holderName: group.ticket_type.toUpperCase().includes("MESA") ? null : null }], `${eventName}_${ticket.code}`);
      return;
    }

    const contact = via === "whatsapp"
      ? window.prompt("Número do WhatsApp do destinatário:", "")
      : via === "email"
        ? window.prompt("E-mail do destinatário:", "")
        : "";
    if (via === "whatsapp" && !contact) return;
    if (via === "email" && (!contact || !contact.includes("@"))) return toast.error("Indique um e-mail válido");

    if (via === "whatsapp") {
      const digits = contact.replace(/\D/g, "");
      const phone = digits.length === 9 ? `244${digits}` : digits;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
      return;
    }

    window.location.href = `mailto:${contact}?subject=${encodeURIComponent("Ingresso — " + eventName)}&body=${encodeURIComponent(text)}`;
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
      <div className="rounded-2xl border bg-card divide-y">
        {isLoading ? <p className="p-6 text-muted-foreground">A carregar…</p> : data.length === 0 ? <p className="p-6 text-muted-foreground">Nenhum ingresso. Gere ingressos no separador “Grupos”.</p> :
          data.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
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
