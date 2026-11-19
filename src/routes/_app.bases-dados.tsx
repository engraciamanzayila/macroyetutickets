import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertCircle, CheckCircle2, Database, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/bases-dados")({
  head: () => ({ meta: [{ title: "Diagnóstico de bases de dados — MY Tickets" }] }),
  component: DatabaseDiagnostics,
});

type Check = { label: string; ok: boolean; detail: string };
type Report = { checkedAt: string; host: string; hosting: string; databaseUrl: string; checks: Check[] };

function detectHosting(host: string) {
  if (host.endsWith(".lovable.app") || host.endsWith(".lovableproject.com")) return "Lovable";
  if (host.endsWith(".vercel.app")) return "Vercel";
  return "Domínio personalizado / outro";
}

function projectRef(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : hostname;
  } catch {
    return "URL não reconhecida";
  }
}

function DatabaseDiagnostics() {
  const { isSuperAdmin } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);

  const runDiagnostics = async () => {
    setRunning(true);
    const host = typeof window === "undefined" ? "indisponível" : window.location.hostname;
    const hosting = detectHosting(host);
    const databaseUrl = import.meta.env["VITE_SUPABASE_URL"] || "";
    const checks: Check[] = [];

    checks.push({
      label: "Hospedagem da aplicação",
      ok: host !== "indisponível",
      detail: `${hosting} · ${host}`,
    });
    checks.push({
      label: "Configuração da base de dados",
      ok: Boolean(databaseUrl),
      detail: databaseUrl ? `Projeto/host: ${projectRef(databaseUrl)}` : "VITE_SUPABASE_URL não está configurada nesta implantação.",
    });

    if (databaseUrl) {
      try {
        const { error } = await supabase.from("credential_batches").select("id", { head: true, count: "exact" });
        checks.push({
          label: "Tabela credential_batches",
          ok: !error,
          detail: error ? error.message : "Tabela encontrada e acessível.",
        });
      } catch (error) {
        checks.push({ label: "Tabela credential_batches", ok: false, detail: (error as Error).message });
      }

      try {
        const { error } = await supabase.from("credentials").select("id", { head: true, count: "exact" });
        checks.push({
          label: "Tabela credentials",
          ok: !error,
          detail: error ? error.message : "Tabela encontrada e acessível.",
        });
      } catch (error) {
        checks.push({ label: "Tabela credentials", ok: false, detail: (error as Error).message });
      }

      try {
        const { error } = await supabase.rpc("check_in_credential", {
          p_event: "00000000-0000-0000-0000-000000000000",
          p_code: "MYTICKETS-DIAGNOSTICO",
        });
        const exists = !error || /forbidden|permission|not allowed/i.test(error.message);
        checks.push({
          label: "Função check_in_credential",
          ok: exists,
          detail: !error ? "Função encontrada e executada (sem alterar dados)." : exists ? `Função encontrada; execução de teste bloqueada pelas permissões: ${error.message}` : error.message,
        });
      } catch (error) {
        checks.push({ label: "Função check_in_credential", ok: false, detail: (error as Error).message });
      }
    }

    setReport({ checkedAt: new Date().toISOString(), host, hosting, databaseUrl: databaseUrl ? projectRef(databaseUrl) : "Não configurada", checks });
    setRunning(false);
  };

  if (!isSuperAdmin) {
    return <div className="rounded-lg border p-6 text-sm text-muted-foreground">Apenas o administrador principal pode consultar o diagnóstico das bases de dados.</div>;
  }

  const passed = report?.checks.filter((check) => check.ok).length ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Administração técnica</p>
        <h1 className="text-3xl font-bold">Diagnóstico de Bases de Dados</h1>
        <p className="text-sm text-muted-foreground">Identifica o domínio de hospedagem e testa, sem modificar dados, a base de dados que esta implantação do MY Tickets está realmente a utilizar.</p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Implantação atual</CardTitle>
              <CardDescription>O domínio identifica onde a aplicação está publicada; a URL configurada identifica a base de dados efetiva.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Hospedagem detetada</p><p className="mt-1 font-semibold">{report?.hosting ?? "Aguardando diagnóstico"}</p></div>
          <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Base de dados configurada</p><p className="mt-1 font-semibold break-all">{report?.databaseUrl ?? "Aguardando diagnóstico"}</p></div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={runDiagnostics} disabled={running}>
          <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "A verificar…" : "Executar diagnóstico"}
        </Button>
        {report && <span className="text-xs text-muted-foreground">Última verificação: {new Date(report.checkedAt).toLocaleString("pt-AO")}</span>}
      </div>

      {report && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant={passed === report.checks.length ? "default" : "destructive"}>{passed}/{report.checks.length} verificações OK</Badge>
            <span className="text-muted-foreground">Nenhuma migração ou alteração foi executada.</span>
          </div>
          <div className="space-y-3">
            {report.checks.map((check) => (
              <Card key={check.label}>
                <CardContent className="flex items-start gap-3 p-4">
                  {check.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />}
                  <div className="min-w-0">
                    <p className="font-medium">{check.label}</p>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{check.detail}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <div className="mb-2 flex items-center gap-2 font-medium text-foreground"><ShieldCheck className="h-4 w-4" /> Segurança e limites</div>
        <p>Este diagnóstico consulta apenas a ligação configurada nesta implantação. Não percorre automaticamente todos os projetos da tua conta Lovable ou Supabase, não mostra chaves secretas e não altera tabelas. Para testar outro projeto, é necessário que essa implantação tenha as respetivas variáveis de ligação configuradas.</p>
      </div>
    </div>
  );
}
