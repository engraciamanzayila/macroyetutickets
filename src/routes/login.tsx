import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  head: () => ({
    meta: [
      { title: "Entrar — MY Tickets" },
      { name: "description", content: "Aceda ao painel de gestão de ingressos MY Tickets." },
      { property: "og:title", content: "Entrar — MY Tickets" },
      { property: "og:description", content: "Painel de gestão de ingressos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Login,
});

function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (session) navigate({ to: "/visao-geral" });
  }, [session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/eventos", data: { full_name: name } },
        });
        if (error) throw error;
        if (!data.session) toast.success("Conta criada. Confirme o seu e-mail para entrar.");
      }
    } catch (err) {
      toast.error((err as Error).message === "Invalid login credentials" ? "E-mail ou palavra-passe incorretos" : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-8 space-y-5">
        <Logo />
        <div>
          <h1 className="text-2xl font-bold">{mode === "in" ? "Entrar" : "Criar conta"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "in" ? "Bem-vindo de volta." : "Crie conta para comprar ingressos ou para vender como promotor."}
          </p>
        </div>
        {mode === "up" && (
          <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        )}
        <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="space-y-2"><Label>Palavra-passe</Label><Input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Aguarde…" : mode === "in" ? "Entrar" : "Criar conta"}</Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />ou<div className="h-px flex-1 bg-border" /></div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={async () => {
            const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/login" });
            if (r.error) toast.error("Falha ao entrar com Google");
          }}
        >
          Continuar com Google
        </Button>
        <button type="button" className="w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Não tem conta? Criar conta" : "Já tem conta? Entrar"}
        </button>
      </form>
    </main>
  );
}
