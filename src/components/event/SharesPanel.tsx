import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ContactRound, Copy, ExternalLink, Mail, MessageCircle, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ensureTickets, type Group } from "@/lib/generate";
import { createTicketFiles, downloadTicketFiles } from "@/lib/ticket-files";
import { canShareFiles, shareFilesThroughDevice } from "@/lib/whatsapp-share";
import { holderLink } from "@/lib/share-render";
import { sendPartnerShareEmail } from "@/lib/order-email.functions";
import { pickDeviceContact } from "@/lib/contact-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KINDS = ["Patrocinador", "Media partner", "Parceiro", "Oferta", "Artista", "Staff", "Outro"];

export function SharesPanel({ eventId, groups }: { eventId: string; groups: Group[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ group_id: "", partner_name: "", partner_kind: "Patrocinador", contact: "", email: "", note: "", qty: 0, expires_at: "" });
  const [shareEmails, setShareEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [whatsAppShare, setWhatsAppShare] = useState<{ id: string; token: string; group_id: string; partner_name: string; contact: string | null } | null>(null);
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);

  const { data: shares = [] } = useQuery({
    queryKey: ["shares", eventId],
    queryFn: async () => (await supabase.from("group_shares").select("*").eq("event_id", eventId).order("created_at")).data ?? [],
  });
  const { data: tix = [] } = useQuery({
    queryKey: ["share-tix", eventId],
    queryFn: async () => {
      const out: { group_id: string; share_id: string | null; status: string; printed_at: string | null; sent_at: string | null; email_delivery_status: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from("tickets").select("group_id,share_id,status,printed_at,sent_at,email_delivery_status").eq("event_id", eventId).range(from, from + 999);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });
  const freeIn = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    const made = tix.filter((t) => t.group_id === gid);
    const taken = made.filter((t) => t.printed_at || t.share_id || t.sent_at || t.email_delivery_status === "sending" || t.email_delivery_status === "sent" || t.status !== "valid").length;
    return Math.max(0, (g?.quantity ?? 0) - taken);
  };
  const link = (token: string) => `${window.location.origin}/p/${token}`;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["shares", eventId] }); qc.invalidateQueries({ queryKey: ["share-tix", eventId] }); };

  const pickPartnerContact = async () => {
    try {
      const picked = await pickDeviceContact();
      if (!picked) return;
      setF((current) => ({
        ...current,
        partner_name: picked.name || current.partner_name,
        contact: picked.phone || current.contact,
        email: picked.email || current.email,
      }));
      toast.success("Contacto preenchido a partir do dispositivo.");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const create = async () => {
    const g = groups.find((x) => x.id === f.group_id);
    if (!g || f.partner_name.trim().length < 2 || f.qty < 1) return toast.error("Escolha o grupo, o nome da entidade e a quantidade");
    setBusy(true);
    try {
      const all = await ensureTickets(g);
      const free = all.filter((t) => !t.printed_at && t.status === "valid" && !t.share_id && !t.sent_at && t.email_delivery_status !== "sending" && t.email_delivery_status !== "sent");
      const pick = free.slice(0, f.qty);
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
      if (f.email.trim()) setShareEmails((current) => ({ ...current, [s.id]: f.email.trim() }));
      toast.success(`Portal criado com ${pick.length} ingressos. Escolha como enviar o convite.`);
      setOpen(false); setF({ ...f, partner_name: "", contact: "", email: "", note: "", qty: 0 });
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const sendPartnerEmail = async (share: (typeof shares)[number]) => {
    const recipient = share.contact?.includes("@")
      ? share.contact.trim()
      : window.prompt(`E-mail de ${share.partner_name}:`)?.trim();
    if (!recipient) return;
    try {
      const result = await sendPartnerShareEmail({
        data: { token: share.token, recipient },
      });
      toast.success(`Convite MY Tickets enviado para ${result.recipient}.`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const whatsappNumber = (share: (typeof shares)[number]) => {
    const suggested = share.contact && !share.contact.includes("@") ? share.contact : "";
    const raw = window.prompt(`Número de WhatsApp de ${share.partner_name}:`, suggested)?.trim();
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9) {
      toast.error("Indique um número de WhatsApp válido.");
      return null;
    }
    return digits.length === 9 ? `244${digits}` : digits;
  };

  const openWhatsAppText = (phone: string, message: string) => {
    const tab = window.open("about:blank", "_blank");
    if (!tab) throw new Error("Permita pop-ups para abrir o WhatsApp.");
    tab.opener = null;
    tab.location.href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  const sendPartnerWhatsAppLink = async (share: (typeof shares)[number], kind: "download" | "management") => {
    const phone = whatsappNumber(share);
    if (!phone) return;
    const group = groups.find((item) => item.id === share.group_id);
    if (!group) return toast.error("Grupo de ingressos não encontrado.");
    try {
      let destination = link(share.token);
      let message = `Olá ${share.partner_name}! A organização do evento ${group.name} partilhou contigo o portal MY Tickets para gerir os ingressos: ${destination}`;
      if (kind === "download") {
        const { data, error } = await supabase
          .from("tickets")
          .select("share_token")
          .eq("share_id", share.id)
          .neq("status", "void")
          .is("printed_at", null)
          .order("seq")
          .limit(50);
        if (error) throw error;
        const tokens = (data ?? []).map((ticket) => ticket.share_token).filter((token): token is string => !!token);
        if (!tokens.length) throw new Error("Não há ingressos disponíveis para criar o link de download.");
        if (tokens.length > 50) throw new Error("O link de download suporta até 50 ingressos por envio.");
        destination = holderLink(tokens);
        message = `Olá ${share.partner_name}! Aqui está o link para descarregar os ${tokens.length} ingresso(s) atribuídos para ${group.name}. Este link permite apenas descarregar os PDFs: ${destination}`;
      }
      openWhatsAppText(phone, message);
      setWhatsAppShare(null);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const sendPartnerWhatsAppFiles = async (share: (typeof shares)[number]) => {
    const group = groups.find((item) => item.id === share.group_id);
    if (!group) return toast.error("Grupo de ingressos não encontrado.");
    setWhatsAppBusy(true);
    const fallbackTab = window.open("about:blank", "_blank");
    try {
      const all = await ensureTickets(group);
      const assigned = all.filter(
        (ticket) => ticket.share_id === share.id && ticket.status === "valid" && !ticket.printed_at && !ticket.sent_at,
      );
      if (!assigned.length) throw new Error("Não há ingressos ainda não distribuídos para enviar em PDF.");
      const items = assigned.map((ticket) => ({ group, ticket }));
      const files = await createTicketFiles(items, group.name, "pdf");
      const message = `Olá ${share.partner_name}! Seguem os ${files.length} ingresso(s) em PDF atribuídos para ${group.name} através da MY Tickets.`;
      if (canShareFiles(files)) {
        if (fallbackTab) fallbackTab.close();
        await shareFilesThroughDevice({ files, ticketIds: assigned.map((ticket) => ticket.id), message, contact: null }, `Ingressos — ${group.name}`);
        toast.success("Ficheiros preparados. Escolha WhatsApp no menu de partilha.");
      } else {
        if (!fallbackTab) throw new Error("Permita pop-ups para descarregar os PDFs e abrir o WhatsApp.");
        await downloadTicketFiles(files);
        const suggested = share.contact && !share.contact.includes("@") ? share.contact : "";
        const raw = window.prompt(`Número de WhatsApp de ${share.partner_name} (ou deixe vazio para escolher no WhatsApp):`, suggested)?.trim() ?? "";
        const digits = raw.replace(/\D/g, "");
        if (digits && digits.length < 9) throw new Error("Indique um número de WhatsApp válido.");
        const phone = digits ? (digits.length === 9 ? `244${digits}` : digits) : "";
        fallbackTab.opener = null;
        fallbackTab.location.href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        toast.info("Os PDFs foram descarregados. Anexe-os à conversa do WhatsApp antes de enviar.");
      }
      setWhatsAppShare(null);
    } catch (error) {
      fallbackTab?.close();
      toast.error((error as Error).message);
    } finally {
      setWhatsAppBusy(false);
    }
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
        <p className="text-sm text-muted-foreground max-w-xl">Atribua ingressos digitais a patrocinadores, media partners e parceiros. Cada entidade recebe um portal próprio para gerir os ingressos, distribuir PDFs pelo WhatsApp e enviar convites por e-mail com um botão seguro de acesso — e acompanhar quem já entrou.</p>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo link de parceiro</Button>
      </div>

      <div className="rounded-2xl border bg-card divide-y">
        {!shares.length && <p className="p-6 text-center text-sm text-muted-foreground">Ainda não há links de parceiros.</p>}
        {shares.map((s) => {
          const mine = tix.filter((t) => t.share_id === s.id && !t.printed_at);
          const sent = mine.filter((t) => t.sent_at).length, used = mine.filter((t) => t.status === "used").length;
          const g = groups.find((x) => x.id === s.group_id);

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
              <Button size="icon" variant="ghost" title="Escolher envio por WhatsApp" onClick={() => setWhatsAppShare(s)}><MessageCircle className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" title="Enviar convite MY Tickets por e-mail" onClick={() => void sendPartnerEmail(s)}><Mail className="h-4 w-4" /></Button>
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
              <div className="space-y-2"><div className="flex gap-2"><Input className="min-w-0" placeholder="Telefone / WhatsApp" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /><Button type="button" size="icon" variant="outline" title="Escolher contacto do dispositivo" onClick={() => void pickPartnerContact()}><ContactRound className="h-4 w-4" /></Button></div><Input type="email" placeholder="E-mail do parceiro (opcional)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            </div>
            <label className="block text-xs text-muted-foreground">Expira em (opcional)<Input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></label>
            <Input placeholder="Nota para a entidade (opcional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <p className="text-xs text-muted-foreground">Só entram ingressos digitais livres (não impressos, não anulados e não atribuídos a outro parceiro).</p>
            <Button className="w-full" disabled={busy} onClick={create}>{busy ? "A criar…" : "Criar link"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!whatsAppShare} onOpenChange={(value) => !whatsAppBusy && !value && setWhatsAppShare(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enviar convite por WhatsApp</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {whatsAppShare ? `Escolha como pretende entregar os ingressos de ${whatsAppShare.partner_name}.` : ""}
          </p>
          <div className="grid gap-2">
            <Button disabled={whatsAppBusy} onClick={() => whatsAppShare && void sendPartnerWhatsAppFiles(whatsAppShare)}>
              {whatsAppBusy ? "A preparar PDFs…" : "Enviar ficheiros PDF"}
            </Button>
            <Button variant="secondary" disabled={whatsAppBusy || !whatsAppShare} onClick={() => whatsAppShare && void sendPartnerWhatsAppLink(whatsAppShare, "download")}>
              Enviar link de download
            </Button>
            <Button variant="secondary" disabled={whatsAppBusy || !whatsAppShare} onClick={() => whatsAppShare && void sendPartnerWhatsAppLink(whatsAppShare, "management")}>
              Enviar link de gestão
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
