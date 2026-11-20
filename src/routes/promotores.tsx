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
  ] }), component: Promoters,
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
  const [accountPassword,setAccountPassword] = useState("");
  const [confirmPassword,setConfirmPassword] = useState("");
  const [busy,setBusy] = useState(false);
  const [accept,setAccept] = useState(false);
  const [wallet,setWallet] = useState<any[]>([]);
  const [messages,setMessages] = useState<any[]>([]);
  const [payoutRequests,setPayoutRequests] = useState<any[]>([]);
  const [payoutAmount,setPayoutAmount] = useState("");
  const [payoutMethod,setPayoutMethod] = useState("bank_transfer");
  const [payoutBusy,setPayoutBusy] = useState(false);
  const [messageDraft,setMessageDraft] = useState("");
  const [messageBusy,setMessageBusy] = useState(false);
  const db = supabase as any;

  useEffect(() => {
    if (!session) return;
    setForm((current) => ({ ...current, email: session.user.email ?? current.email, full_name: session.user.user_metadata?.full_name ?? current.full_name, phone: session.user.phone ?? current.phone }));
    let alive = true;
    void db.from("promoter_applications").select("id,status,application_data,document_paths,promoter_signed_at,admin_note").eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle().then(({data}: {data:AppRow|null}) => {
      if (alive && data) { setApplication(data); setForm({...initial,...data.application_data}); setSignature(data.application_data?.full_name ?? ""); }
    });
    return () => { alive=false; };
  },[session,db]);

  useEffect(() => {
    if (!session || !application?.id) return;
    let alive = true;
    void db.from("promoter_messages").select("id,sender_id,body,created_at").eq("application_id",application.id).order("created_at",{ascending:true}).then(({data}: {data:any[]|null}) => {
      if (alive) setMessages(data ?? []);
    });
    if (application.status === "approved") {
      void db.from("promoter_wallet_summary").select("*").eq("promoter_id",session.user.id).order("event_name").then(({data}: {data:any[]|null}) => {
        if (alive) setWallet(data ?? []);
      });
      void db.from("promoter_payout_requests").select("*").eq("promoter_id",session.user.id).order("created_at",{ascending:false}).then(({data}: {data:any[]|null}) => {
        if (alive) setPayoutRequests(data ?? []);
      });
    }
    return () => { alive=false; };
  },[session,application?.id,application?.status,db]);

  const requestPayout = async () => {
    if (!payoutAmount || Number(payoutAmount)<=0) return toast.error("Indique um valor válido.");
    setPayoutBusy(true);
    const {error}=await db.rpc("request_promoter_payout",{p_amount:Number(payoutAmount),p_method:payoutMethod});
    if(error) toast.error(error.message);
    else {
      toast.success("Pedido de levantamento enviado para análise.");
      setPayoutAmount("");
      const {data}=await db.from("promoter_payout_requests").select("*").eq("promoter_id",session?.user.id).order("created_at",{ascending:false});
      setPayoutRequests(data ?? []);
    }
    setPayoutBusy(false);
  };

  const sendMessage = async () => {
    if (!session || !application?.id || !messageDraft.trim()) return;
    setMessageBusy(true);
    const {error} = await db.from("promoter_messages").insert({application_id:application.id,sender_id:session.user.id,body:messageDraft.trim()});
    if (error) toast.error(error.message);
    else {
      setMessageDraft("");
      const {data} = await db.from("promoter_messages").select("id,sender_id,body,created_at").eq("application_id",application.id).order("created_at",{ascending:true});
      setMessages(data ?? []);
    }
    setMessageBusy(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accept) return toast.error("Confirme que os dados são verdadeiros.");
    if (!session && (accountPassword.length < 8 || accountPassword !== confirmPassword)) return toast.error("Confirme uma palavra-passe com pelo menos 8 caracteres.");
    setBusy(true);
    try {
      let userId = session?.user.id;
      if (!userId) {
        const {data:authData,error:authError} = await supabase.auth.signUp({
          email:form.email,
          password:accountPassword,
          options:{emailRedirectTo:window.location.origin+"/login?next=%2Fpromotores",data:{full_name:form.full_name,phone:form.phone,account_type:"promoter"}},
        });
        if (authError) throw authError;
        if (!authData.session || !authData.user) {
          toast.success("Conta criada. Confirme o e-mail e depois entre para concluir o envio dos documentos e a assinatura.");
          setAccountPassword("");
          setConfirmPassword("");
          return;
        }
        userId=authData.user.id;
      }
      const paths:string[] = [];
      for (const file of files) {
        if (!["application/pdf","image/jpeg","image/png"].includes(file.type)) throw new Error("Os documentos devem ser PDF, JPG ou PNG.");
        if (file.size > 10*1024*1024) throw new Error("Cada documento deve ter no máximo 10 MB.");
        const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"-");
        const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
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

  const estimatedShare=wallet.reduce((n,r)=>n+Number(r.estimated_promoter_share||0),0);
  const reservedPayouts=payoutRequests.filter(r=>["pending","approved"].includes(r.status)).reduce((n,r)=>n+Number(r.amount||0),0);
  const estimatedAvailable=Math.max(0,estimatedShare-reservedPayouts);

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
    {session && application && !["changes_requested","rejected"].includes(application.status) ? <section className="rounded-2xl border bg-card p-6 space-y-3">
      <h2 className="text-xl font-bold">A sua candidatura</h2>
      <p className="font-semibold">{statusLabel[application.status] ?? application.status}</p>
      {application.admin_note && <p className="rounded-lg bg-secondary p-3 text-sm">Nota da administração: {application.admin_note}</p>}
      {application.document_paths?.length > 0 && <p className="text-sm text-muted-foreground">{application.document_paths.length} documento(s) privado(s) anexado(s).</p>}
      {application.status === "approved" && <p className="text-sm text-muted-foreground">A conta já recebeu o perfil de promotor.</p>}
    </section> : <section className="rounded-2xl border bg-card p-6 md:p-8">
      <div className="mb-6"><h2 className="text-2xl font-bold">{application ? "Corrigir candidatura" : "Formulário de candidatura"}</h2><p className="text-sm text-muted-foreground">Preencha os dados com atenção. Os documentos ficam guardados num espaço privado e só podem ser consultados por si e pela administração.</p></div>
      <form className="space-y-6" onSubmit={submit}>
        {!session && <div className="rounded-lg bg-primary/5 p-3 text-sm">Este formulário cria a sua conta de promotor e envia a candidatura no mesmo processo. Se já tem uma conta MY Tickets, <a className="font-semibold text-primary underline" href="/login?next=%2Fpromotores">entre aqui</a> antes de preencher.</div>}
        <div className="space-y-3"><h3 className="font-semibold">1. Identificação e contacto</h3><div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Tipo de promotor</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={form.promoter_type} onChange={e=>setForm({...form,promoter_type:e.target.value})}><option value="individual">Pessoa singular</option><option value="company">Empresa / pessoa colectiva</option></select></div>
          {([["full_name","Nome completo"],["birth_date","Data de nascimento"],["nationality","Nacionalidade"],["bi_number","Nº do BI / Passaporte"],["nif","NIF"],["phone","Telefone / WhatsApp"],["email","E-mail"],["address","Morada completa"]] as const).map(([key,label])=><div className="space-y-1" key={key}><Label>{label}</Label><Input type={key==="birth_date"?"date":key==="email"?"email":"text"} required={!["birth_date","nationality"].includes(key)} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></div>)}
        </div>
        {!session && <><div className="space-y-1"><Label>Palavra-passe da conta</Label><Input type="password" minLength={8} autoComplete="new-password" required value={accountPassword} onChange={e=>setAccountPassword(e.target.value)}/></div><div className="space-y-1"><Label>Confirmar palavra-passe</Label><Input type="password" minLength={8} autoComplete="new-password" required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></div></>}
        </div>
        <div className="space-y-3 border-t pt-5"><h3 className="font-semibold">2. Dados da empresa (quando aplicável)</h3><div className="grid gap-3 sm:grid-cols-2">
          {([["company_name","Nome legal da empresa"],["company_nif","NIF da empresa"],["legal_representative","Representante legal"],["business_activity","Actividade / ramo"]] as const).map(([key,label])=><div className="space-y-1" key={key}><Label>{label}</Label><Input required={form.promoter_type==="company"} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></div>)}
          <div className="space-y-1 sm:col-span-2"><Label>Portfólio / experiência na organização de eventos</Label><Textarea value={form.portfolio} onChange={e=>setForm({...form,portfolio:e.target.value})} rows={3}/></div>
        </div></div>
        <div className="space-y-3 border-t pt-5"><h3 className="font-semibold">3. Dados para pagamentos</h3><div className="grid gap-3 sm:grid-cols-2">
          {([["bank_name","Banco"],["account_holder","Titular da conta"],["iban","IBAN"],["express_phone","Número Multicaixa Express"]] as const).map(([key,label])=><div className="space-y-1" key={key}><Label>{label}{key==="iban"?" *":""}</Label><Input required={key==="iban"} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></div>)}
        </div><p className="text-xs text-muted-foreground">Os dados bancários são tratados como informação confidencial. A plataforma não efectua transferências automaticamente nesta etapa.</p></div>
        <div className="space-y-3 border-t pt-5"><h3 className="font-semibold">4. Documentos</h3><p className="text-sm text-muted-foreground">Anexe BI/Passaporte, comprovativo de NIF e, se representar uma empresa, documento de registo e prova de poderes de representação. PDF, JPG ou PNG; máximo 10 MB por ficheiro.</p><Input type="file" multiple required={files.length < 2} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={e=>setFiles(Array.from(e.target.files ?? []))}/>{files.length>0&&<p className="text-xs text-muted-foreground">{files.map(f=>f.name).join(" · ")}</p>}{application?.document_paths?.length ? <p className="text-xs text-muted-foreground">Documentos anteriormente enviados: {application.document_paths.length}</p> : null}</div>
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
          <div className="flex items-start gap-2"><Checkbox checked={accept} onCheckedChange={v=>setAccept(!!v)}/><span className="text-sm">Declaro que os dados e documentos fornecidos são verdadeiros e autorizo a sua análise pela MY Tickets para efeitos de candidatura.</span></div><div className="space-y-1"><Label>Assinatura do promotor (nome completo)</Label><Input required value={signature} onChange={e=>setSignature(e.target.value)} placeholder="Nome igual ao documento de identificação"/></div><p className="text-xs text-muted-foreground">A assinatura e a aprovação ficam registadas com data e hora. A validade jurídica da assinatura electrónica deve respeitar os requisitos legais aplicáveis em Angola.</p><Button type="submit" disabled={busy}>{busy?"A enviar candidatura…":session?"Enviar candidatura e assinar":"Criar conta de promotor e enviar candidatura"}</Button>{application&&<Button type="button" variant="outline" onClick={signAgain}>Actualizar assinatura</Button>}</div>
      </form>
    </section>}
    {session && application && <section className="rounded-2xl border bg-card p-6 space-y-5">
      {application.status === "approved" && <div className="space-y-3">
        <div><h2 className="text-xl font-bold">Carteira do promotor</h2><p className="text-sm text-muted-foreground">Resumo das vendas pagas e da comissão calculada por evento.</p></div>
        {wallet.length === 0 ? <p className="text-sm text-muted-foreground">Ainda não existem vendas pagas associadas à sua conta.</p> : <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Vendas pagas</p><p className="text-xl font-bold">{wallet.reduce((n,r)=>n+Number(r.paid_tickets||0),0)}</p></div>
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Comissão MY Tickets</p><p className="text-xl font-bold">{wallet.reduce((n,r)=>n+Number(r.platform_commission_amount||0),0).toLocaleString("pt-AO")} Kz</p></div>
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Quota estimada do promotor</p><p className="text-xl font-bold">{wallet.reduce((n,r)=>n+Number(r.estimated_promoter_share||0),0).toLocaleString("pt-AO")} Kz</p></div>
          </div>
          <div className="divide-y rounded-lg border">{wallet.map(row=><div key={row.event_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><div><b>{row.event_name}</b><p className="text-xs text-muted-foreground">{row.paid_tickets} bilhetes · {row.paid_orders} encomendas · comissão {row.platform_commission_pct}%</p></div><div className="text-right"><b>{Number(row.estimated_promoter_share||0).toLocaleString("pt-AO")} Kz</b><p className="text-xs text-muted-foreground">quota estimada</p></div></div>)}</div>
        </>}
        <div className="border-t pt-4 space-y-3">
          <h3 className="font-semibold">Pedidos de levantamento</h3>
          <p className="text-sm text-muted-foreground">Quota estimada ainda não reservada: <b>{estimatedAvailable.toLocaleString("pt-AO")} Kz</b>. O pedido será analisado manualmente; não há transferência automática.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input type="number" min="1" max={estimatedAvailable} step="0.01" value={payoutAmount} onChange={e=>setPayoutAmount(e.target.value)} placeholder="Valor em Kz"/>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={payoutMethod} onChange={e=>setPayoutMethod(e.target.value)}><option value="bank_transfer">Transferência bancária (IBAN)</option><option value="multicaixa_express">Multicaixa Express</option></select>
            <Button type="button" disabled={payoutBusy||!payoutAmount||Number(payoutAmount)>estimatedAvailable} onClick={()=>void requestPayout()}>{payoutBusy?"A enviar…":"Solicitar"}</Button>
          </div>
          {payoutRequests.length>0&&<div className="divide-y rounded-lg border">{payoutRequests.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><div><b>{Number(r.amount).toLocaleString("pt-AO")} Kz</b><p className="text-xs text-muted-foreground">{r.payment_method==="bank_transfer"?"Transferência bancária":"Multicaixa Express"} · {new Date(r.created_at).toLocaleString("pt-AO")}</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs">{({pending:"Pendente",approved:"Aprovado",rejected:"Recusado",paid:"Pago"} as Record<string,string>)[r.status]??r.status}</span></div>)}</div>}
        </div>
        <p className="text-xs text-muted-foreground">Estes valores são uma estimativa sobre encomendas marcadas como pagas. Não representam ainda saldo levantável; o fluxo de recebimento centralizado, impostos, taxas e regras de levantamento tem de estar configurado e aprovado antes de qualquer pagamento.</p>
      </div>}
      <div className="space-y-3">
        <div><h2 className="text-xl font-bold">Mensagens com a MY Tickets</h2><p className="text-sm text-muted-foreground">Envie dúvidas ou documentos adicionais relacionados com esta candidatura. A conversa fica guardada no seu processo.</p></div>
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-3">
          {messages.length===0 ? <p className="text-sm text-muted-foreground">Ainda não há mensagens nesta conversa.</p> : messages.map(m=><div key={m.id} className={m.sender_id===session.user.id?"ml-8 rounded-lg bg-primary/10 p-3":"mr-8 rounded-lg bg-muted p-3"}><p className="mb-1 text-xs font-semibold">{m.sender_id===session.user.id?"Você":"MY Tickets"} · {new Date(m.created_at).toLocaleString("pt-AO")}</p><p className="whitespace-pre-wrap text-sm">{m.body}</p></div>)}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row"><Textarea value={messageDraft} onChange={e=>setMessageDraft(e.target.value)} placeholder="Escreva a sua mensagem…" rows={2}/><Button type="button" disabled={messageBusy||!messageDraft.trim()} onClick={()=>void sendMessage()}>{messageBusy?"A enviar…":"Enviar mensagem"}</Button></div>
      </div>
    </section>}
  </main></>;
}
