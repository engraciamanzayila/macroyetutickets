import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Group } from "@/lib/generate";
import { holderLink, downloadPdf, type RenderGroup } from "@/lib/share-render";
import { artUrl } from "@/lib/generate";
import { sendTicketEmail } from "@/lib/order-email.functions";
import { releaseTicketsForRedistribution } from "@/lib/ticket-admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

/** Direct dispatch of available tickets, with superadmin-only redistribution of marked tickets. */
export function AdminDispatchPanel({ eventId, eventName, groups }: { eventId: string; eventName: string; groups: Group[] }) {
  const qc = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [resendMarked, setResendMarked] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: tickets = [] } = useQuery({
    queryKey: ["admin-dispatch", eventId],
    queryFn: async () => {
      const rows: { id: string; code: string; group_id: string; share_token: string; holder_name: string | null; status: string; printed_at: string | null; share_id: string | null; sent_at: string | null; email_delivery_status: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("tickets").select("id,code,group_id,share_token,holder_name,status,printed_at,share_id,sent_at,email_delivery_status").eq("event_id", eventId).order("seq").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
  const available = tickets.filter(t => t.status === "valid" && !t.printed_at && !t.share_id && !t.sent_at && t.email_delivery_status !== "sent" && t.email_delivery_status !== "sending");
  const marked = tickets.filter(t => t.status === "valid" && (!!t.printed_at || !!t.sent_at || t.email_delivery_status === "sent"));
  const source = resendMarked && isSuperAdmin ? marked : available;
  const picked = groups.flatMap(g => source.filter(t => t.group_id === g.id).slice(0, Math.max(0, quantities[g.id] || 0)));
  const message = () => `Olá${name.trim() ? " " + name.trim() : ""}! Aqui estão ${picked.length} ingresso(s) para ${eventName}:\n${holderLink(picked.map(t => t.share_token))}\nApresente o QR Code à entrada.`;
  const send = async (via: "whatsapp" | "email" | "link" | "download") => {
    if (!picked.length) return toast.error("Escolha a quantidade em pelo menos um grupo");
    if (resendMarked && picked.length > 500) return toast.error("Selecione até 500 ingressos marcados por operação");
    if (picked.length > 100 && via === "email") return toast.error("Selecione até 100 ingressos por e-mail");
    if (picked.length > 50 && via !== "download" && via !== "email") return toast.error("Selecione até 50 ingressos por link");
    if (via === "whatsapp" && !contact.replace(/\D/g, "")) return toast.error("Indique o número de WhatsApp");
    if (via === "email" && !contact.includes("@")) return toast.error("Indique um e-mail válido");
    setBusy(true);
    try {
      if (via === "download") {
        const items = await Promise.all(picked.map(async t => {
          const g = groups.find(g => g.id === t.group_id)!;
          return { g: { ...g, art_url: await artUrl(g.art_path ?? "") } as RenderGroup, code: t.code, holderName: g.ticket_type.toUpperCase().includes("MESA") ? t.holder_name : null };
        }));
        if (items.some(i => !i.g.art_url)) throw new Error("Há grupos sem arte disponível");
        await downloadPdf(items, eventName + "_ingressos");
      } else if (via === "email") {
        if (resendMarked) {
          await releaseTicketsForRedistribution({ data: { eventId, ticketIds: picked.map((ticket) => ticket.id) } });
        }
        const result = await sendTicketEmail({ data: { eventId, ticketIds: picked.map((ticket) => ticket.id), recipient: contact.trim() } });
        if (result.status !== "sent") throw new Error("O Zoho não confirmou o envio");
        toast.success(`E-mail enviado a ${result.recipient}${result.cc.length ? ` · CC: ${result.cc.join(", ")}` : ""}`);
      } else if (via === "link") {
        await navigator.clipboard.writeText(message());
        toast.success("Mensagem e link copiados");
      } else if (via === "whatsapp") {
        const digits = contact.replace(/\D/g, "");
        const phone = digits.length === 9 ? "244" + digits : digits;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message())}`, "_blank");
      }
      if (via !== "email") {
        const ids = picked.map(t => t.id);
        if (resendMarked) {
          await releaseTicketsForRedistribution({ data: { eventId, ticketIds: ids } });
        }
        const { error } = await supabase.from("tickets").update({
          sent_via: via, sent_at: new Date().toISOString(), holder_contact: contact.trim() || null,
        }).in("id", ids).eq("event_id", eventId).eq("status", "valid").is("printed_at", null).is("share_id", null).is("sent_at", null);
        if (error) throw error;
      }
      setQuantities({});
      qc.invalidateQueries({ queryKey: ["admin-dispatch", eventId] });
      qc.invalidateQueries({ queryKey: ["share-tix", eventId] });
      qc.invalidateQueries({ queryKey: ["tickets", eventId] });
      qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] });
      if (via !== "email") toast.success("Seleção registada como distribuída");
    } catch (e) {
      qc.invalidateQueries({ queryKey: ["admin-dispatch", eventId] });
      qc.invalidateQueries({ queryKey: ["tickets", eventId] });
      qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] });
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };
  return <div className="space-y-4 rounded-2xl border bg-card p-4">
    <div><h3 className="font-semibold">Envio direto pela administração</h3><p className="text-sm text-muted-foreground">Escolha quantos ingressos digitais pretende enviar de cada grupo, sem criar um portal de parceiro.</p></div>
    {isSuperAdmin && <label className="flex items-center gap-2 text-sm"><Checkbox checked={resendMarked} onCheckedChange={(checked) => { setResendMarked(!!checked); setQuantities({}); }} /> Incluir ingressos já enviados ou impressos (apenas superadministrador)</label>}
    {groups.map(g => { const count = source.filter(t => t.group_id === g.id).length; return <label key={g.id} className="flex items-center justify-between gap-3 text-sm"><span>{g.name} · {g.ticket_type} <span className="text-muted-foreground">({count} {resendMarked ? "marcados" : "livres"})</span></span><Input aria-label={`Quantidade de ${g.name}`} type="number" min={0} max={count} className="w-24" value={quantities[g.id] || ""} onChange={e => setQuantities(v => ({ ...v, [g.id]: Math.min(count, Math.max(0, Number(e.target.value) || 0)) }))} /></label>; })}
    <div className="grid gap-2 sm:grid-cols-2"><Input placeholder="Nome do destinatário (opcional)" value={name} onChange={e => setName(e.target.value)} /><Input placeholder="WhatsApp ou e-mail" value={contact} onChange={e => setContact(e.target.value)} /></div>
    <p className="text-sm font-medium">{picked.length} ingresso(s) selecionado(s)</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !picked.length} onClick={() => send("whatsapp")}>WhatsApp</Button><Button disabled={busy || !picked.length} variant="secondary" onClick={() => send("email")}>E-mail</Button><Button disabled={busy || !picked.length} variant="secondary" onClick={() => send("link")}>Copiar link</Button><Button disabled={busy || !picked.length} variant="secondary" onClick={() => send("download")}>Baixar PDF</Button></div>
  </div>;
}
