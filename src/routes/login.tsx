import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [
    { title: "Entrar — MY Tickets" },
    { name: "description", content: "Aceda à sua conta MY Tickets." },
    { property: "og:title", content: "Entrar — MY Tickets" },
  ] }),
  component: Login,
});

function Login() {
  const [mode,setMode] = useState<"in"|"up">("in");
  const [method,setMethod] = useState<"email"|"phone">("email");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [name,setName] = useState("");
  const [phone,setPhone] = useState("");
  const [otp,setOtp] = useState("");
  const [otpSent,setOtpSent] = useState(false);
  const [busy,setBusy] = useState(false);
  const {session} = useAuth();
  const next = (() => { const value = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("next"); return value?.startsWith("/") && !value.startsWith("//") ? value : "/"; })();

  useEffect(() => {
    if (session) window.location.assign(next);
  },[session,next]);

  const emailSubmit = async (e:React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      if(mode==="in") {
        const {error}=await supabase.auth.signInWithPassword({email,password});
        if(error) throw error;
      } else {
        const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+next,data:{full_name:name,account_type:"customer"}}});
        if(error) throw error;
        if(!data.session) toast.success("Conta criada. Confirme o código/link enviado para o seu e-mail.");
        else toast.success("Conta criada com sucesso.");
      }
    } catch(error) { toast.error((error as Error).message==="Invalid login credentials"?"E-mail ou palavra-passe incorrectos":(error as Error).message); }
    finally {setBusy(false);}
  };

  const sendOtp = async (e:React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const {error}=await supabase.auth.signInWithOtp({phone,options:{shouldCreateUser:mode==="up",data:{full_name:name,account_type:"customer"}}});
      if(error) throw error;
      setOtpSent(true); toast.success("Código OTP enviado por SMS. Introduza-o para confirmar o número.");
    } catch(error) {toast.error((error as Error).message);}
    finally {setBusy(false);}
  };

  const verifyOtp = async (e:React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const {error}=await supabase.auth.verifyOtp({phone,token:otp,type:"sms"});
      if(error) throw error;
      toast.success("Número confirmado. A sua conta está pronta.");
    } catch(error) {toast.error((error as Error).message);}
    finally {setBusy(false);}
  };

  return <main className="min-h-screen grid place-items-center px-4 py-10">
    <div className="w-full max-w-md rounded-2xl border bg-card p-7 space-y-5">
      <Logo/>
      <div><h1 className="text-2xl font-bold">{mode==="in"?"Entrar":"Criar conta de cliente"}</h1><p className="mt-1 text-sm text-muted-foreground">{mode==="in"?"Aceda à sua conta MY Tickets.":"Escolha como pretende criar a sua conta de consumidor. A candidatura de promotor é feita num formulário separado."}</p></div>
      <div className="grid grid-cols-2 gap-2"><Button type="button" variant={mode==="in"?"default":"outline"} onClick={()=>{setMode("in");setOtpSent(false);}}>Entrar</Button><Button type="button" variant={mode==="up"?"default":"outline"} onClick={()=>{setMode("up");setOtpSent(false);}}>Criar conta</Button></div>
      <div className="grid grid-cols-2 gap-2"><Button type="button" size="sm" variant={method==="email"?"secondary":"ghost"} onClick={()=>setMethod("email")}>E-mail</Button><Button type="button" size="sm" variant={method==="phone"?"secondary":"ghost"} onClick={()=>setMethod("phone")}>Telemóvel / OTP</Button></div>
      {method==="email" ? <form onSubmit={emailSubmit} className="space-y-4">
        {mode==="up"&&<div className="space-y-1"><Label>Nome completo</Label><Input value={name} onChange={e=>setName(e.target.value)} required/></div>}
        <div className="space-y-1"><Label>E-mail</Label><Input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
        <div className="space-y-1"><Label>Palavra-passe</Label><Input type="password" autoComplete={mode==="in"?"current-password":"new-password"} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/></div>
        <Button type="submit" className="w-full" disabled={busy}>{busy?"Aguarde…":mode==="in"?"Entrar":"Criar conta"}</Button>
      </form> : <div className="space-y-4">
        {mode==="up"&&!otpSent&&<div className="space-y-1"><Label>Nome completo</Label><Input value={name} onChange={e=>setName(e.target.value)} required/></div>}
        <form onSubmit={otpSent?verifyOtp:sendOtp} className="space-y-3">
          <div className="space-y-1"><Label>Número de telefone com indicativo do país</Label><Input type="tel" placeholder="+244 9XX XXX XXX" value={phone} onChange={e=>setPhone(e.target.value)} required disabled={otpSent}/></div>
          {otpSent&&<div className="space-y-1"><Label>Código OTP recebido por SMS</Label><Input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={e=>setOtp(e.target.value)} required/></div>}
          <Button type="submit" className="w-full" disabled={busy}>{busy?"Aguarde…":otpSent?"Confirmar código":"Enviar código OTP"}</Button>
          {otpSent&&<Button type="button" variant="ghost" className="w-full" onClick={()=>{setOtpSent(false);setOtp("");}}>Alterar número / reenviar</Button>}
        </form>
      </div>}
      <div className="relative flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border"/><span>ou</span><span className="h-px flex-1 bg-border"/></div>
      <Button type="button" variant="secondary" className="w-full" onClick={async()=>{const r=await lovable.auth.signInWithOAuth("google",{redirect_uri:window.location.origin+next});if(r.error)toast.error("Não foi possível iniciar a autenticação Google.");}}>Continuar com Google</Button>
      <p className="text-xs text-muted-foreground">A autenticação por SMS depende de o fornecedor OTP estar activado e configurado no Supabase. Os dados legais de promotor não são pedidos neste cadastro de cliente.</p>
      <a href="/promotores" className="block text-center text-sm text-primary hover:underline">Quero candidatar-me como promotor</a>
    </div>
  </main>;
}
