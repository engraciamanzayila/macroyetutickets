import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/equipa")({
  head: () => ({
    meta: [
      { title: "Equipa — MY Tickets" },
      { name: "description", content: "Gerir quem tem acesso ao painel e à portaria." },
      { property: "og:title", content: "Equipa — MY Tickets" },
      { property: "og:description", content: "Gerir acessos da equipa." },
    ],
  }),
  component: Team,
});

import type { Role } from "@/lib/access";
const SUPER = "macroyetu@gmail.com";

function Team() {
  const { session, isAdmin } = useAuth();
  const isSuper = session?.user.email?.toLowerCase() === SUPER;
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      return (profiles ?? []).map((p) => ({ ...p, roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as Role) }));
    },
  });


  const { data: applications = [], refetch: refetchApplications } = useQuery({
    queryKey: ["promoter-applications"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("promoter_applications").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [applicationNotes, setApplicationNotes] = useState<Record<string,string>>({});
  const [applicationReplies, setApplicationReplies] = useState<Record<string,string>>({});
  const [payoutNotes, setPayoutNotes] = useState<Record<string,string>>({});
  const [payoutReferences, setPayoutReferences] = useState<Record<string,string>>({});
  const { data: payoutRequests = [], refetch: refetchPayouts } = useQuery({
    queryKey: ["promoter-payout-requests"], enabled: isAdmin,
    queryFn: async () => { const {data,error}=await (supabase as any).from("promoter_payout_requests").select("*").order("created_at",{ascending:false}); if(error) throw error; return data ?? []; },
  });
  const { data: promoterMessages = [], refetch: refetchPromoterMessages } = useQuery({
    queryKey: ["promoter-messages-admin"], enabled: isAdmin,
    queryFn: async () => { const {data,error}=await (supabase as any).from("promoter_messages").select("id,application_id,sender_id,body,created_at").order("created_at",{ascending:true}); if(error) throw error; return data ?? []; },
  });
  const reviewApplication = async (id: string, decision: string) => {
    const { error } = await (supabase as any).rpc("review_promoter_application", {
      p_application: id, p_decision: decision, p_note: applicationNotes[id] ?? "",
      p_admin_name: session?.user.user_metadata?.full_name ?? session?.user.email ?? "MY Tickets",
    });
    if (error) return toast.error(error.message);
    toast.success(decision === "approved" ? "Promotor aprovado e acesso activado." : "Estado da candidatura actualizado.");
    await refetchApplications();
    qc.invalidateQueries({ queryKey: ["team"] });
  };
  const reviewPayout = async (id:string,decision:string) => {
    const {error}=await (supabase as any).rpc("review_promoter_payout",{p_request:id,p_decision:decision,p_note:payoutNotes[id]??"",p_reference:payoutReferences[id]??""});
    if(error) return toast.error(error.message);
    toast.success(decision==="paid"?"Pagamento registado.":"Pedido actualizado.");
    await refetchPayouts();
  };
  const sendPromoterReply = async (applicationId: string) => {
    const body=(applicationReplies[applicationId] ?? "").trim();
    if (!body || !session) return;
    const {error}=await (supabase as any).from("promoter_messages").insert({application_id:applicationId,sender_id:session.user.id,body});
    if(error) return toast.error(error.message);
    setApplicationReplies(v=>({...v,[applicationId]:""}));
    await refetchPromoterMessages();
    toast.success("Mensagem enviada ao promotor.");
  };
  const openDocument = async (path: string) => {
    const { data, error } = await supabase.storage.from("promoter-documents").createSignedUrl(path, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const setRole = async (uid: string, role: Role | null) => {
    if (role === "promoter") return toast.error("A activação de promotores só pode ocorrer pela aprovação de uma candidatura com contrato assinado.");
    if (uid === session?.user.id) return toast.error("Não pode alterar o seu próprio acesso.");
    const del = await supabase.from("user_roles").delete().eq("user_id", uid).select();
    if (del.error) return toast.error(del.error.message);
    if (role) {
      const rolesToInsert = role === "operations_support"
        ? ["consumer_support", "promoter_support"]
        : [role];
      const { error } = await supabase.from("user_roles").insert(
        rolesToInsert.map((assignedRole) => ({ user_id: uid, role: assignedRole as Role }))
      );
      if (error) return toast.error(role === "admin" ? "Só o administrador principal pode nomear administradores." : error.message);
      if (role === "promoter") await supabase.from("profiles").update({ wants_promoter: false }).eq("id", uid);
    }
    qc.invalidateQueries({ queryKey: ["team"] });
  };

  if (!isAdmin) return <p className="text-muted-foreground">Apenas administradores.</p>;
  const pending = data.filter((p) => p.wants_promoter && !p.roles.includes("promoter"));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Equipa</h1>
        <p className="text-muted-foreground text-sm">
          <b>Portaria</b>: só lê QR e vê os ingressos. <b>Promotor</b>: cria eventos (gratuito) que a administração aprova. <b>Gestão (Admin)</b>: aprova eventos e promotores, gera ingressos extra. Só o administrador principal pode nomear ou retirar membros da gestão.
        </p>
      </div>
      {pending.length > 0 && <p className="rounded-lg bg-primary/10 text-sm p-3"><b>{pending.length}</b> pedido(s) de promotor por aprovar.</p>}

      <section className="space-y-4">
        <div><h2 className="text-2xl font-bold">Pedidos de levantamento</h2><p className="text-sm text-muted-foreground">Confirme os fundos recebidos e os dados de destino antes de aprovar. Marque como pago apenas depois da transferência efectuada.</p></div>
        {payoutRequests.length===0 ? <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Ainda não existem pedidos.</p> : payoutRequests.map((p:any)=><article key={p.id} className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-bold">{Number(p.amount).toLocaleString("pt-AO")} Kz</h3><p className="text-xs text-muted-foreground">Promotor: {applications.find((a:any)=>a.user_id===p.promoter_id)?.application_data?.full_name ?? p.promoter_id} · {p.payment_method==="bank_transfer"?"Transferência bancária":"Multicaixa Express"} · {new Date(p.created_at).toLocaleString("pt-AO")}</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs">{p.status}</span></div>
          <div className="rounded-lg bg-muted/40 p-3 text-sm">{p.payment_method==="bank_transfer" ? <><p>Banco: {p.destination_snapshot?.bank_name||"—"}</p><p>Titular: {p.destination_snapshot?.account_holder||"—"}</p><p>IBAN: {p.destination_snapshot?.iban||"—"}</p></> : <><p>Multicaixa Express: {p.destination_snapshot?.phone||"—"}</p><p>Titular: {p.destination_snapshot?.holder||"—"}</p></>}</div>
          {p.admin_note&&<p className="text-sm text-muted-foreground">Nota: {p.admin_note}</p>}
          <textarea className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" placeholder="Nota administrativa" value={payoutNotes[p.id]??p.admin_note??""} onChange={e=>setPayoutNotes(v=>({...v,[p.id]:e.target.value}))}/>
          {p.status==="approved"&&<Input placeholder="Referência da transferência efectuada" value={payoutReferences[p.id]??""} onChange={e=>setPayoutReferences(v=>({...v,[p.id]:e.target.value}))}/>}
          <div className="flex flex-wrap gap-2">{p.status==="pending"&&<><Button size="sm" onClick={()=>void reviewPayout(p.id,"approved")}>Aprovar pedido</Button><Button size="sm" variant="destructive" onClick={()=>void reviewPayout(p.id,"rejected")}>Recusar</Button></>}{p.status==="approved"&&<Button size="sm" disabled={!(payoutReferences[p.id]??"").trim()} onClick={()=>void reviewPayout(p.id,"paid")}>Registar como pago</Button>}</div>
        </article>)}
      </section>
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Candidaturas de promotores</h2>
          <p className="text-sm text-muted-foreground">Verifique dados e documentos antes de aprovar. O acesso de promotor só é concedido pela aprovação depois da assinatura do candidato.</p>
        </div>
        {applications.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Ainda não existem candidaturas.</p> : applications.map((app: any) => {
          const d = app.application_data ?? {};
          return <article key={app.id} className="rounded-2xl border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="font-bold">{d.full_name || d.company_name || "Candidato"}</h3><p className="text-xs text-muted-foreground">{d.email} · {d.phone} · {d.promoter_type === "company" ? "Empresa" : "Pessoa singular"}</p></div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{app.status}</span>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {([["BI / Passaporte",d.bi_number],["NIF",d.nif],["Morada",d.address],["Empresa",d.company_name],["NIF da empresa",d.company_nif],["Representante legal",d.legal_representative],["Banco",d.bank_name],["Titular",d.account_holder],["IBAN",d.iban],["Multicaixa Express",d.express_phone],["Actividade",d.business_activity]] as const).filter(([,v])=>!!v).map(([label,value])=><p key={label}><span className="text-muted-foreground">{label}: </span><b>{value}</b></p>)}
            </div>
            {d.portfolio && <p className="text-sm"><span className="text-muted-foreground">Experiência: </span>{d.portfolio}</p>}
            <div className="flex flex-wrap gap-2">{(app.document_paths ?? []).map((path: string,index:number)=><Button key={path} size="sm" variant="outline" onClick={()=>void openDocument(path)}>Documento {index+1} · abrir</Button>)}</div>
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-semibold">Conversa com o candidato</p>
              <div className="max-h-52 space-y-2 overflow-y-auto">
                {promoterMessages.filter((m:any)=>m.application_id===app.id).length===0 ? <p className="text-xs text-muted-foreground">Sem mensagens ainda.</p> : promoterMessages.filter((m:any)=>m.application_id===app.id).map((m:any)=><div key={m.id} className={m.sender_id===app.user_id?"rounded-md bg-muted p-2":"rounded-md bg-primary/10 p-2"}><p className="text-xs font-semibold">{m.sender_id===app.user_id?"Promotor":"MY Tickets"} · {new Date(m.created_at).toLocaleString("pt-AO")}</p><p className="whitespace-pre-wrap text-sm">{m.body}</p></div>)}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row"><textarea className="min-h-16 flex-1 rounded-md border bg-background p-2 text-sm" value={applicationReplies[app.id] ?? ""} onChange={e=>setApplicationReplies(v=>({...v,[app.id]:e.target.value}))} placeholder="Responder ao promotor…"/><Button size="sm" onClick={()=>void sendPromoterReply(app.id)} disabled={!(applicationReplies[app.id] ?? "").trim()}>Enviar resposta</Button></div>
            </div>
            <p className="text-xs text-muted-foreground">Assinatura do promotor: {app.promoter_signed_name || "Em falta"}{app.promoter_signed_at ? " · " + new Date(app.promoter_signed_at).toLocaleString("pt-AO") : ""}</p>
            {app.admin_signed_at && <p className="text-xs text-muted-foreground">Aprovado e assinado por {app.admin_signed_name} · {new Date(app.admin_signed_at).toLocaleString("pt-AO")}</p>}
            {app.admin_note && <p className="rounded-md bg-secondary p-2 text-sm">Nota anterior: {app.admin_note}</p>}
            <textarea className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" placeholder="Nota para o candidato / correcções necessárias" value={applicationNotes[app.id] ?? app.admin_note ?? ""} onChange={e=>setApplicationNotes(v=>({...v,[app.id]:e.target.value}))}/>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={()=>void reviewApplication(app.id,"under_review")}>Marcar em análise</Button>
              <Button size="sm" variant="secondary" onClick={()=>void reviewApplication(app.id,"changes_requested")}>Pedir correcções</Button>
              <Button size="sm" variant="destructive" onClick={()=>void reviewApplication(app.id,"rejected")}>Rejeitar</Button>
              <Button size="sm" disabled={!app.promoter_signed_at} onClick={()=>void reviewApplication(app.id,"approved")}>Aprovar e activar promotor</Button>
            </div>
          </article>;
        })}
      </section>

      <div className="rounded-2xl border bg-card divide-y">
        {data.map((p) => {
          const current: Role | null = p.roles.includes("admin") ? "admin"
            : p.roles.includes("promoter") ? "promoter"
            : p.roles.includes("staff") ? "staff"
            : p.roles.includes("consumer_support") || p.roles.includes("promoter_support") ? "operations_support"
            : null;
          const targetSuper = p.email?.toLowerCase() === SUPER;
          const lockedRow = p.id === session?.user.id || targetSuper || (current === "admin" && !isSuper);
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold">{p.full_name || p.email}{targetSuper && <span className="ml-2 text-xs text-primary">Administrador principal</span>}</p>
                <p className="text-xs text-muted-foreground">{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
                {p.wants_promoter && current !== "promoter" && <p className="text-xs text-primary font-medium">Pediu para ser promotor</p>}
              </div>
              <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
                {([[null, "Sem acesso"], ["staff", "Portaria"], ["operations_support", "Equipa de Operações e Apoio"], ["promoter", "Promotor (por candidatura)"], ["admin", "Gestão"]] as const).map(([r, l]) => (
                  <Button key={l} size="sm" variant={current === r ? "default" : "ghost"} disabled={lockedRow || r === "promoter" || (r === "admin" && !isSuper)} onClick={() => setRole(p.id, r)}>{l}</Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
