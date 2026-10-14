import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Mail, MessageCircle, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ensureTickets, type Group } from "@/lib/generate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KINDS = ["Patrocinador", "Media partner", "Parceiro", "Oferta", "Artista", "Staff", "Outro"];

export function SharesPanel({ eventId, groups }: { eventId: string; groups: Group[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ group_id: "", partner_name: "", partner_kind: "Patrocinador", contact: "", note: "", qty: 0, expires_at: "" });
  const [busy, setBusy] = useState(false);

  const { data: shares = [] } = useQuery({
    queryKey: ["shares", eventId],
    queryFn: async () => (await supabase.from("group_shares").select("*").eq("event_id", eventId).order("created_at")).data ?? [],
  });
  const { data: tix = [] } = useQuery({
    queryKey: ["share-tix", eventId],
    queryFn: async () => {
      const out: { group_id: string; share_id: string | null; status: string; printed_at: string | null; sent_at: string | null }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from("tickets").select("group_id,share_id,status,printed_at,sent_at").eq("event_id", eventId).range(from, from + 999);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });
  const freeIn = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    const made = tix.filter((t) => t.group_id === gid);
    const taken = made.filter((t) => t.printed_at || t.share_id || t.status !== "valid").length;
    return Math.max(0, (g?.quantity ?? 0) - taken);
  };
  const link = (token: string) => `${window.location.origin}/p/${token}`;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["shares", eventId] }); qc.invalidateQueries({ queryKey: ["share-tix", eventId] }); };

  const create = async () => {
    const g = groups.find((x) => x.id === f.group_id);
    if (!g || f.partner_name.trim().length < 2 || f.qty < 1) return toast.error("Escolha o grupo, o nome da entidade e a quantidade");
    setBusy(true);
    try {
      const all = await ensureTickets(g);
      const free = all.filter((t) => !t.printed_at && t.status === "valid" && !(t as { share_id?: string | null }).share_id);
      const { data: assigned } = await supabase.from("tickets").select("id").eq("group_id", g.id).not("share_id", "is", null);
      const busyIds = new Set((assigned ?? []).map((r) => r.id));
      const pick = free.filter((t) => !busyIds.has(t.id)).slice(0, f.qty);
      if (pick.length < f.qty) throw new Error(`Só há ${pick.length} ingressos digitais livres neste grupo`);
      const { data: u } = await supabase.auth.getUser();
      const { data: s, error } = await supabase.from("group_shares").insert({
        event_id: eventId, group_id: g.id, partner_name: f.partner_name.trim(), partner_kind: f.partner_kind,
        contact: f.contact.trim() || null, note: f.note.trim() || null, expires_at: f.expires_at ? new Date(f.expires_at + "T23:59:59").toISOString() : null, created_by: u.user?.id,
      }).select().single();
      if (error) throw error;
      for (let i = 0; i < pick.length; i += 300) {
        const { error: e2 } = await supabase.from("tickets").update({ share_id: s.id }).in("id", pick.slice(i, i + 300).map((t) => t.id));
        if (e2) throw e2;
      }
      await navigator.clipboard.writeText(link(s.token)).catch(() => {});
      toast.success(`Link criado com ${pick.length} ingressos (copiado)`);
      setOpen(false); setF({ ...f, partner_name: "", contact: "", note: "", qty: 0 });
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Apagar este link? Os ingressos voltam a ficar livres (os já enviados continuam válidos).")) return;
    await supabase.from("tickets").update({ share_id: null }).eq("share_id", id).is("sent_at", null);
    const { error } = await supabase.from("group_shares").delete().eq("id", id);
    if (error) toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">Atribua ingressos digitais a patrocinadores, media partners e parceiros. Cada entidade recebe um link próprio onde envia os ingressos por WhatsApp, e-mail, link ou PDF — e vê quem já entrou.</p>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo link de parceiro</Button>
      </div>

      <div className="rounded-2xl border bg-card divide-y">
        {!shares.length && <p className="p-6 text-center text-sm text-muted-foreground">Ainda não há links de parceiros.</p>}
        {shares.map((s) => {
          const mine = tix.filter((t) => t.share_id === s.id && !t.printed_at);
          const sent = mine.filter((t) => t.sent_at).length, used = mine.filter((t) => t.status === "used").length;
          const g = groups.find((x) => x.id === s.group_id);
          const wa = s.contact ? `https://wa.me/${s.contact.replace(/\D/g, "").replace(/^(\d{9})$/, "244$1")}?text=${encodeURIComponent(`Olá ${s.partner_name}! Aqui está o seu portal para gerir e enviar os ${mine.length} ingressos de ${g?.name}: ${link(s.token)}`)}` : "";
          return (
            <div key={s.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px]">
                <p className="font-semibold">{s.partner_name} <Badge variant="secondary" className="ml-1">{s.partner_kind}</Badge></p>
                <p className="text-xs text-muted-foreground">{g?.name} · {mine.length} atribuídos · {sent} enviados · {used} entraram{s.expires_at ? ` · expira ${new Date(s.expires_at).toLocaleDateString("pt-AO")}` : ""}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={s.active} onCheckedChange={async (v) => { await supabase.from("group_shares").update({ active: v }).eq("id", s.id); refresh(); }} /> {s.active ? "Ativo" : "Desativado"}
              </label>
              <Button size="icon" variant="ghost" title="Copiar link" onClick={() => navigator.clipboard.writeText(link(s.token)).then(() => toast.success("Link copiado"))}><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" title="Abrir portal" asChild><a href={link(s.token)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
              {wa && <Button size="icon" variant="ghost" title="Enviar link por WhatsApp" asChild><a href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /></a></Button>
              {s.contact?.includes("@") && <Button size="icon" variant="ghost" title="Enviar link por e-mail" asChild><a href={`mailto:${s.contact}?subject=${encodeURIComponent("Ingressos — " + (g?.name ?? ""))}&body=${encodeURIComponent(`Olá ${s.partner_name}, aqui está o seu portal para gerir e enviar os ingressos: ${link(s.token)}`)}`}><Mail className="h-4 w-4" /></a></Button>}}
              <Button size="icon" variant="ghost" title="Apagar" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo link de parceiro</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <select value={f.group_id} onChange={(e) => setF({ ...f, group_id: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Grupo de ingressos…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.ticket_type} ({freeIn(g.id)} livres)</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Nome da entidade" value={f.partner_name} onChange={(e) => setF({ ...f, partner_name: e.target.value })} />
              <select value={f.partner_kind} onChange={(e) => setF({ ...f, partner_kind: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm">
                {KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min={1} max={f.group_id ? freeIn(f.group_id) : undefined} placeholder="Quantidade" value={f.qty || ""} onChange={(e) => setF({ ...f, qty: parseInt(e.target.value) || 0 })} />
              <Input placeholder="WhatsApp / e-mail da entidade" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
            </div>
            <label className="block text-xs text-muted-foreground">Expira em (opcional)<Input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></label>
            <Input placeholder="Nota para a entidade (opcional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <p className="text-xs text-muted-foreground">Só entram ingressos digitais livres (não impressos, não anulados e não atribuídos a outro parceiro).</p>
            <Button className="w-full" disabled={busy} onClick={create}>{busy ? "A criar…" : "Criar link"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
