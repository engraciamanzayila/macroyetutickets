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

type Ev = { id: string; name: string; event_date: string | null; venue: string | null; city: string | null; approval_status: string; approval_note: string | null; published: boolean; commission_pct: number };

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
  const [form, setForm] = useState<Record<string, string>>({});
  const [exclusive, setExclusive] = useState(false);
  const [agree, setAgree] = useState(false);
  const [sign, setSign] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (contract) { setForm(contract.data as Record<string, string>); setExclusive(contract.exclusive); }
    else setForm((f) => ({ email: session?.user.email ?? "", ...f }));
  }, [contract, session]);

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

  const d = form;
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
          {isAdmin && (
            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center gap-2 text-sm">
                <span>Comissão</span>
                <Input type="number" step="0.5" defaultValue={event.commission_pct} className="h-8 w-24" onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== event.commission_pct) setPct(v); }} />%
              </div>
              <Textarea placeholder="Nota para o promotor (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button onClick={() => review(true)}>Aprovar</Button>
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
            <div className="text-sm"><p className="font-medium">Venda exclusiva na MACRO YETU TICKETs</p><p className="text-muted-foreground text-xs">Comissão reduzida de {COMMISSION_EXCLUSIVE}% em vez de {COMMISSION_STANDARD}%. Os ingressos não podem ser vendidos noutras plataformas.</p></div>
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
        <p><b>Cláusula 4ª — Exclusividade.</b> {exclusive ? "O segundo outorgante compromete-se a vender os ingressos deste evento exclusivamente através da plataforma MACRO YETU TICKETs. O incumprimento implica a aplicação da comissão normal de 10% sobre todas as vendas." : "Não há exclusividade: o segundo outorgante pode vender ingressos noutros canais."}</p>
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
