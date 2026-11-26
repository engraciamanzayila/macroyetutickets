import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { APPROVAL_LABEL, COMMISSION_EXCLUSIVE, COMMISSION_STANDARD, COMPANY } from "@/lib/company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type Ev = { id: string; owner_id: string | null; promoter_assigned_at: string | null; name: string; slug: string | null; event_date: string | null; venue: string | null; city: string | null; approval_status: string; approval_note: string | null; published: boolean; commission_pct: number; ticket_email_cc: string | null; ticket_email_extra_cc: string[] };

const FIELDS = [
  ["company", "Empresa / nome do promotor"],
  ["nif", "NIF"],
  ["representative", "Representante legal"],
  ["bi", "Nº do BI / Passaporte"],
  ["phone", "Telefone"],
  ["email", "E-mail"],
  ["address", "Morada"],
  ["iban", "IBAN para receber as vendas"],
  ["capacity", "Lotação prevista"],
] as const;

export function ContractPanel({ event }: { event: Ev }) {
  const { isAdmin, session } = useAuth();
  const qc = useQueryClient();
  const { data: contract } = useQuery({
    queryKey: ["contract", event.id],
    queryFn: async () => (await supabase.from("event_contracts").select("*").eq("event_id", event.id).maybeSingle()).data,
  });
  const { data: assignedPromoterRole } = useQuery({
    queryKey: ["event-approval-promoter-role", event.owner_id],
    enabled: !!event.owner_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", event.owner_id!);
      if (error) throw error;
      const roles = (data ?? []).map((item) => item.role);
      return roles.includes("promoter") && !roles.some((role) => ["admin", "staff", "consumer_support", "promoter_support"].includes(role));
    },
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [exclusive, setExclusive] = useState(false);
  const [agree, setAgree] = useState(false);
  const [sign, setSign] = useState("");
  const [note, setNote] = useState("");
  const [promoterCc, setPromoterCc] = useState(event.ticket_email_cc ?? "");
  const [extraCc, setExtraCc] = useState((event.ticket_email_extra_cc ?? []).join(", "));

  useEffect(() => {
    if (contract) { setForm(contract.data as Record<string, string>); setExclusive(contract.exclusive); }
    else setForm((f) => ({ email: session?.user.email ?? "", ...f }));
  }, [contract, session]);

  useEffect(() => {
    setPromoterCc(event.ticket_email_cc ?? "");
    setExtraCc((event.ticket_email_extra_cc ?? []).join(", "));
  }, [event.id, event.ticket_email_cc, event.ticket_email_extra_cc]);

  const locked = !!contract?.admin_signed_at;
  const pct = exclusive ? COMMISSION_EXCLUSIVE : COMMISSION_STANDARD;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["contract", event.id] }); qc.invalidateQueries({ queryKey: ["event", event.id] }); };

  const submit = async () => {
    if (!agree) return toast.error("Aceite os termos do contrato.");
    const missing = FIELDS.filter(([k]) => !form[k]?.trim() && k !== "iban" && k !== "capacity");
    if (missing.length) return toast.error("Preencha: " + missing.map((m) => m[1]).join(", "));
    const { error } = await supabase.rpc("sign_contract", { p_event: event.id, p_exclusive: exclusive, p_data: form, p_name: sign });
    if (error) return toast.error(error.message);
    toast.success("Contrato assinado e enviado para aprovação");
    refresh();
  };
  const review = async (approve: boolean) => {
    const { error } = await supabase.rpc("review_event", { p_event: event.id, p_approve: approve, p_note: note });
    if (error) return toast.error(error.message);
    toast.success(approve ? "Evento aprovado" : "Evento recusado");
    refresh();
  };
  const setPct = async (v: number) => {
    const { error } = await supabase.from("events").update({ commission_pct: v }).eq("id", event.id);
    if (error) toast.error(error.message); else refresh();
  };

  const saveEmailCopies = async () => {
    const addresses = extraCc.split(/[;,\s]+/).map((email) => email.trim()).filter(Boolean);
    const all = [promoterCc.trim(), ...addresses].filter(Boolean);
    if (all.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return toast.error("Verifique os endereços de e-mail e separe as cópias com vírgula");
    }
    const { error } = await supabase.from("events").update({
      ticket_email_cc: promoterCc.trim() || null,
      ticket_email_extra_cc: [...new Set(addresses.map((email) => email.toLowerCase()))],
    }).eq("id", event.id);
    if (error) return toast.error(error.message);
    toast.success("Destinatários em cópia guardados para este evento");
    refresh();
  };

  const d = form as Partial<Record<(typeof FIELDS)[number][0], string>>;
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-5">
        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-lg">Estado</h2>
            <Badge variant={event.approval_status === "approved" ? "default" : "secondary"}>{APPROVAL_LABEL[event.approval_status] ?? event.approval_status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Comissão da plataforma: <b className="text-foreground">{event.commission_pct}%</b> por ingresso vendido. Entrar e publicar é gratuito.</p>
          {event.approval_note && <p className="text-sm rounded-md bg-secondary p-3">Nota da administração: {event.approval_note}</p>}
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor="event-promoter-cc" className="text-xs">E-mail do promotor em CC</Label>
              <Input id="event-promoter-cc" type="email" value={promoterCc} onChange={(e) => setPromoterCc(e.target.value)} placeholder="Usar o e-mail da conta do promotor" />
              <p className="text-xs text-muted-foreground">Se ficar em branco, usamos automaticamente o e-mail da conta que criou este evento.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="event-extra-cc" className="text-xs">Outros e-mails em CC</Label>
              <Input id="event-extra-cc" value={extraCc} onChange={(e) => setExtraCc(e.target.value)} placeholder="financeiro@empresa.ao, assistente@empresa.ao" />
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => void saveEmailCopies()}>Guardar cópias de e-mail</Button>
          </div>
          {isAdmin && (
            <div className="space-y-3 border-t pt-3"><Textarea placeholder="Nota para o promotor (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              {!assignedPromoterRole && <p className="text-xs text-amber-700">Antes de aprovar, associe uma conta de Promotor no separador Responsável. O Administrador não pode ser o responsável operacional.</p>}
              <div className="flex gap-2">
                <Button disabled={!assignedPromoterRole} onClick={() => review(true)}>Aprovar</Button>
                <Button variant="secondary" onClick={() => review(false)}>Recusar</Button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <h2 className="font-bold text-lg">Dados do promotor</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.map(([k, l]) => (
              <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label><Input disabled={locked} value={d[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
            ))}
          </div>
          <label className="flex gap-3 items-start rounded-lg border p-3 cursor-pointer">
            <Checkbox disabled={locked} checked={exclusive} onCheckedChange={(v) => setExclusive(!!v)} />
            <div className="text-sm"><p className="font-medium">Venda exclusiva na MY Tickets</p><p className="text-muted-foreground text-xs">Comissão reduzida de {COMMISSION_EXCLUSIVE}% em vez de {COMMISSION_STANDARD}%. Os ingressos não podem ser vendidos noutras plataformas.</p></div>
          </label>
          {!locked && (
            <>
              <label className="flex gap-2 items-center text-sm"><Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} /> Li e aceito o contrato ao lado</label>
              <div className="space-y-1"><Label className="text-xs">Assinatura eletrónica — escreva o seu nome completo</Label><Input value={sign} onChange={(e) => setSign(e.target.value)} className="font-serif italic text-lg" /></div>
              <Button className="w-full" onClick={submit}>{contract ? "Assinar novamente e reenviar" : "Assinar e enviar para aprovação"}</Button>
            </>
          )}
        </div>
      </div>

      <article className="rounded-2xl border bg-card p-6 text-sm leading-relaxed space-y-3 h-fit">
        <h2 className="text-center font-bold text-lg">CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE BILHETEIRA</h2>
        <p><b>Primeira outorgante:</b> {COMPANY.name}, NIF {COMPANY.nif}, com sede em {COMPANY.address}, e-mail {COMPANY.email}, representada por {COMPANY.representative}.</p>
        <p><b>Segundo outorgante:</b> {d.company || "____"}, NIF {d.nif || "____"}, com morada em {d.address || "____"}, representado por {d.representative || "____"}, portador do BI/Passaporte nº {d.bi || "____"}, telefone {d.phone || "____"}, e-mail {d.email || "____"}.</p>
        <p><b>Cláusula 1ª — Objeto.</b> A primeira outorgante disponibiliza a sua plataforma para a criação, venda, entrega e validação dos ingressos do evento <b>{event.name}</b>{event.event_date ? `, a realizar em ${new Date(event.event_date).toLocaleDateString("pt-PT")}` : ""}{event.venue ? `, em ${event.venue}` : ""}{event.city ? `, ${event.city}` : ""}{d.capacity ? `, com lotação prevista de ${d.capacity} pessoas` : ""}.</p>
        <p><b>Cláusula 2ª — Custos.</b> O registo do promotor e a publicação do evento são gratuitos.</p>
        <p><b>Cláusula 3ª — Comissão.</b> A primeira outorgante cobra <b>{pct}%</b> sobre o valor de cada ingresso vendido na plataforma{exclusive ? ", taxa reduzida por se tratar de venda exclusiva" : ""}.</p>
        <p><b>Cláusula 4ª — Exclusividade.</b> {exclusive ? `O segundo outorgante compromete-se a vender os ingressos deste evento exclusivamente através da plataforma MY Tickets. O incumprimento implica a aplicação da comissão normal de ${COMMISSION_STANDARD}% sobre todas as vendas.` : "Não há exclusividade: o segundo outorgante pode vender ingressos noutros canais."}</p>
        <p><b>Cláusula 5ª — Pagamentos.</b> O valor das vendas, deduzida a comissão, é transferido para o IBAN {d.iban || "indicado pelo promotor"} após a realização do evento.</p>
        <p><b>Cláusula 6ª — Aprovação.</b> O evento só é publicado depois de avaliado e aprovado pela administração da plataforma.</p>
        <p><b>Cláusula 7ª — Responsabilidade.</b> A realização do evento, licenças e eventuais reembolsos são da responsabilidade do segundo outorgante.</p>
        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div><p className="text-xs text-muted-foreground">Pela plataforma</p><p className="font-serif italic text-base">{contract?.admin_signed_name ?? "—"}</p><p className="text-xs text-muted-foreground">{contract?.admin_signed_at ? new Date(contract.admin_signed_at).toLocaleString("pt-PT") : "Por assinar"}</p></div>
          <div><p className="text-xs text-muted-foreground">Pelo promotor</p><p className="font-serif italic text-base">{contract?.signed_name ?? (sign || "—")}</p><p className="text-xs text-muted-foreground">{contract ? new Date(contract.signed_at).toLocaleString("pt-PT") : "Por assinar"}</p></div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>Imprimir / guardar PDF</Button>
      </article>
    </div>
  );
}
