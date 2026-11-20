import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StoreHeader } from "@/components/store/StoreHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { COMMISSION_EXCLUSIVE, COMMISSION_STANDARD } from "@/lib/company";
import { toast } from "sonner";

export const Route = createFileRoute("/promotores")({
  head: () => ({ meta: [
    { title: "Promotores — MY Tickets" },
    { name: "description", content: `Publique eventos em Angola sem custo de adesão. Comissão de ${COMMISSION_STANDARD}%, ou ${COMMISSION_EXCLUSIVE}% em exclusividade.` },
    { property: "og:title", content: "Promotores — MY Tickets" },
    { property: "og:description", content: "Os seus eventos, mais perto do público." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ]), component: Promoters,
});

type AppRow = { id: string; status: string; application_data: Record<string,string>; document_paths: string[]; promoter_signed_at: string | null; admin_note: string | null };
const initial = { promoter_type:"individual", full_name:"", birth_date:"", nationality:"Angolana", bi_number:"", nif:"", phone:"", email:"", address:"", company_name:"", company_nif:"", legal_representative:"", business_activity:"", portfolio:"", bank_name:"", account_holder:"", iban:"", express_phone:"", notes:"" };
const statusLabel: Record<string,string> = { pending:"Recebida — aguarda análise", under_review:"Em análise pela equipa", changes_requested:"Precisa de correcções", approved:"Aprovada — acesso de promotor activo", rejected:"Não aprovada" };

function Promoters() {
  const { session } = useAuth();
  const [form,setForm] = useState(initial);
  const [files,setFiles] = useState<File[]>([]);
  const [application,setApplication] = useState<AppRow|null>(null);
  const [signature,setSignature] = useState("");
  const [busy,setBusy] = useState(false);
  const [accept,setAccept] = useState(false);
  const db = supabase as any;

  useEffect(() => {
    if (!session) return;
    let alive = true;
    void db.from("promoter_applications").select("id,status,application_data,document_paths,promoter_signed_at,admin_note").eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle().then(({data}: {data:AppRow|null}) => {
      if (alive && data) { setApplication(data); setForm({...initial,...data.application_data}); setSignature(data.application_data?.full_name ?? ""); }
    });
    return () => { alive=false; };
  },[session,db]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) return toast.error("Entre ou crie primeiro a sua conta de cliente para associar a candidatura.");
    if (!accept) return toast.error("Confirme que os dados são verdadeiros.");
    setBusy(true);
    try {
      const paths:string[] = [];
      for (const file of files) {
        if (!["application/pdf","image/jpeg","image/png"].includes(file.type)) throw new Error("Os documentos devem ser PDF, JPG ou PNG.");
        if (file.size > 10*1024*1024) throw new Error("Cada documento deve ter no máximo 10 MB.");
        const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"-");
        const path = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
        const {error} = await supabase.storage.from("promoter-documents").upload(path,file,{upsert:false,contentType:file.type});
        if (error) throw error;
        paths.push(path);
      }
      const {data,error} = await db.rpc("submit_promoter_application",{p_data:form,p_documents:paths});
      if (error) throw error;
      const {error:signError} = await db.rpc("sign_promoter_application",{p_application:data,p_name:form.full_name});
      if (signError) throw signError;
      toast.success("Candidatura enviada e assinatura registada. A equipa MY Tickets irá analisar.");
      const {data:row} = await db.from("promoter_applications").select("id,status,application_data,document_paths,promoter_signed_at,admin_note").eq("id",data).single();
      setApplication(row);
      setFiles([]);
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const signAgain = async () => {
    if (!application || !signature.trim()) return toast.error("Escreva o seu nome completo.");
    const {error} = await db.rpc("sign_promoter_application",{p_application:application.id,p_name:signature});
    if (error) return toast.error(error.message);
    toast.success("Assinatura actualizada.");
    setApplication({...application,promoter_signed_at:new Date().toISOString()});
  };

  return <><StoreHeader/><main className="mx-auto max-w-5xl px-5 py-12 space-y-10">
    <section className="max-w-3xl">
      <p className="text-primary font-semibold tracking-wider">ESPAÇO DO PROMOTOR</p>
      <h1 className="mt-3 text-4xl font-bold">Os seus eventos na MY Tickets</h1>
      <p className="mt-5 text-lg text-muted-foreground">O registo e a publicação são gratuitos. A comissão é de <strong className="text-foreground">{COMMISSION_STANDARD}%</strong> por ingresso vendido. Para eventos com exclusividade na MY Tickets, a comissão é de <strong className="text-foreground">{COMMISSION_EXCLUSIVE}%</strong>.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-4"><p className="text-3xl font-bold">{COMMISSION_STANDARD}%</p><p className="text-sm text-muted-foreground">Promotor geral — sem exclusividade</p></div>
        <div className="rounded-xl border p-4"><p className="text-3xl font-bold">{COMMISSION_EXCLUSIVE}%</p><p className="text-sm text-muted-foreground">Promotor exclusivo — vendas apenas na MY Tickets</p></div>
      </div>
      <p className="mt-5 text-sm text-muted-foreground">A candidatura exige identificação, informação fiscal, contactos, dados de pagamento e documentação. A equipa analisa os dados e documentos. O acesso de promotor só é activado depois da aprovação e assinatura de ambas as partes.</p>
    </section>
    {!session ? <section className="rounded-2xl border bg-card p-6 space-y-3">
      <h2 className="text-xl font-bold">Primeiro, aceda à sua conta</h2>
      <p className="text-sm text-muted-foreground">A conta de cliente é independente da candidatura. Depois de entrar, volte a esta página para preencher e enviar o formulário legal de promotor.</p>
      <Button asChild><a href="/login?next=%2Fpromotores">Entrar ou criar conta</a></Button>
    </section> : application && !["changes_requested","rejected"].includes(application.status) ? <section className="rounded-2xl border bg-card p-6 space-y-3">
      <h2 className="text-xl font-bold">A sua candidatura</h2>
      <p className="font-semibold">{statusLabel[application.status] ?? application.status}</p>
      {application.admin_note && <p className="rounded-lg bg-secondary p-3 text-sm">Nota da administração: {application.admin_note}</p>}
      {application.document_paths?.length > 0 && <p className="text-sm text-muted-foreground">{application.document_paths.length} documento(s) privado(s) anexado(s).</p>}
      {application.status === "approved" && <p className="text-sm text-muted-foreground">A conta já recebeu o perfil de promotor.</p>}
    </section> : <section className="rounded-2xl border bg-card p-6 md:p-8">
      <div className="mb-6"><h2 className="text-2xl font-bold">{application ? "Corrigir candidatura" : "Formulário de candidatura"}</h2><p className="text-sm text-muted-foreground">Preencha os dados com atenção. Os documentos ficam guardados num espaço privado e só podem ser consultados por si e pela administração.</p></div>
      <form className="space-y-6" onSubmit={submit}>
        <div className="space-y-3"><h3 className="font-semibold">1. Identificação e contacto</h3><div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Tipo de promotor</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={form.promoter_type} onChange={e=>setForm({...form,promoter_type:e.target.value})}><option value="individual">Pessoa singular</option><option value="company">Empresa / pessoa colectiva</option></select></div>
          {([["full_name","Nome completo"],["birth_date","Data de nascimento"],["nationality","Nacionalidade"],["bi_number","Nº do BI / Passaporte"],["nif","NIF"],["phone","Telefone / WhatsApp"],["email","E-mail"],["address","Morada completa"]] as const).map(([key,label])=><div className="space-y-1" key={key}><Label>{label}</Label><Input type={key==="birth_date"?"date":key==="email"?"email":"text"} required={!["birth_date","nationality"].includes(key)} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></div>)}
        </div></div>
        <div className="space-y-3 border-t pt-5"><h3 className="font-semibold">2. Dados da empresa (quando aplicável)</h3><div className="grid gap-3 sm:grid-cols-2">
          {([["company_name","Nome legal da empresa"],["company_nif","NIF da empresa"],["legal_representative","Representante legal"],["business_activity","Actividade / ramo"]] as const).map(([key,label])=><div className="space-y-1" key={key}><Label>{label}</Label><Input required={form.promoter_type==="company"} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></div>)}
          <div className="space-y-1 sm:col-span-2"><Label>Portfólio / experiência na organização de eventos</Label><Textarea value={form.portfolio} onChange={e=>setForm({...form,portfolio:e.target.value})} rows={3}/></div>
        </div></div>
        <div className="space-y-3 border-t pt-5"><h3 className="font-semibold">3. Dados para pagamentos</h3><div className="grid gap-3 sm:grid-cols-2">
          {([["bank_name","Banco"],["account_holder","Titular da conta"],["iban","IBAN"],["express_phone","Número Multicaixa Express"]] as const).map(([key,label])=><div className="space-y-1" key={key}><Label>{label}{key==="iban"?" *":""}</Label><Input required={key==="iban"} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></div>)}
        </div><p className="text-xs text-muted-foreground">Os dados bancários são tratados como informação confidencial. A plataforma não efectua transferências automaticamente nesta etapa.</p></div>
        <div className="space-y-3 border-t pt-5"><h3 className="font-semibold">4. Documentos</h3><p className="text-sm text-muted-foreground">Anexe BI/Passaporte, comprovativo de NIF e, se representar uma empresa, documento de registo e prova de poderes de representação. PDF, JPG ou PNG; máximo 10 MB por ficheiro.</p><Input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={e=>setFiles(Array.from(e.target.files ?? []))}/>{files.length>0&&<p className="text-xs text-muted-foreground">{files.map(f=>f.name).join(" · ")}</p>}{application?.document_paths?.length ? <p className="text-xs text-muted-foreground">Documentos anteriormente enviados: {application.document_paths.length}</p> : null}</div>
        <div className="border-t pt-5 space-y-3">
          <article className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
            <h3 className="font-semibold">Termos do contrato de adesão — MY Tickets</h3>
            <p><b>1. Serviço.</b> A MY Tickets disponibiliza ferramentas para divulgação, gestão, venda, emissão e validação de ingressos dos eventos aprovados.</p>
            <p><b>2. Custos e comissão.</b> Não existe taxa de adesão nem de publicação. A comissão aplicável é de <b>{COMMISSION_STANDARD}%</b> por ingresso vendido no regime geral ou <b>{COMMISSION_EXCLUSIVE}%</b> quando o evento tiver exclusividade contratada na MY Tickets.</p>
            <p><b>3. Exclusividade.</b> A taxa exclusiva aplica-se apenas aos eventos em que o promotor aceite expressamente vender os ingressos exclusivamente através da MY Tickets. Sem exclusividade, aplica-se a taxa geral.</p>
            <p><b>4. Veracidade e documentos.</b> O promotor declara que os dados e documentos são verdadeiros, está autorizado a representar a entidade indicada e deve comunicar qualquer alteração relevante.</p>
            <p><b>5. Análise e activação.</b> A candidatura fica sujeita à verificação da MY Tickets. A conta só recebe permissões de promotor após assinatura do candidato, aprovação e assinatura da plataforma.</p>
            <p><b>6. Pagamentos e conformidade.</b> As liquidações, prazos, taxas externas, impostos, cancelamentos e reembolsos serão regulados pelas condições operacionais e pelo contrato específico do evento, sem promessa de transferência automática nesta candidatura.</p>
            <p className="text-xs text-muted-foreground">Versão 2026-11. O documento e o mecanismo de assinatura devem ser validados juridicamente para cumprimento da legislação angolana antes da utilização comercial definitiva.</p>
          </article>
          <div className="flex items-start gap-2"><Checkbox checked={accept} onCheckedChange={v=>setAccept(!!v)}/><span className="text-sm">Declaro que os dados e documentos fornecidos são verdadeiros e autorizo a sua análise pela MY Tickets para efeitos de candidatura.</span></div><div className="space-y-1"><Label>Assinatura do promotor (nome completo)</Label><Input required value={signature} onChange={e=>setSignature(e.target.value)} placeholder="Nome igual ao documento de identificação"/></div><p className="text-xs text-muted-foreground">A assinatura e a aprovação ficam registadas com data e hora. A validade jurídica da assinatura electrónica deve respeitar os requisitos legais aplicáveis em Angola.</p><Button type="submit" disabled={busy}>{busy?"A enviar candidatura…":"Enviar candidatura e assinar"}</Button>{application&&<Button type="button" variant="outline" onClick={signAgain}>Actualizar assinatura</Button>}</div>
      </form>
    </section>}
  </main></>;
}
