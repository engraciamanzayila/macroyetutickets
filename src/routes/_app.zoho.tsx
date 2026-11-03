import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getZohoMailStatus, saveZohoSelfClient } from "@/lib/order-email.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/zoho")({
  head: () => ({ meta: [{ title: "E-mail Zoho — MY Tickets" }] }),
  component: ZohoSettings,
});

const DATA_CENTERS = [
  ["com", "Zoho.com"],
  ["eu", "Zoho Europe"],
  ["in", "Zoho India"],
  ["com.au", "Zoho Australia"],
  ["jp", "Zoho Japan"],
  ["com.cn", "Zoho China"],
  ["com.sa", "Zoho Saudi Arabia"],
  ["com.tr", "Zoho Turkey"],
  ["ca", "Zoho Canada"],
  ["com.br", "Zoho Brazil"],
];

function ZohoSettings() {
  const { session, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [code, setCode] = useState("");
  const [dataCenter, setDataCenter] = useState("com");
  const [saving, setSaving] = useState(false);
  const isPrimaryAdmin = isAdmin && session?.user.email?.toLowerCase() === "macroyetu@gmail.com";
  const statusQuery = useQuery({
    queryKey: ["zoho-mail-status"],
    queryFn: () => getZohoMailStatus(),
    enabled: isPrimaryAdmin,
    retry: false,
  });

  if (!isPrimaryAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Apenas o administrador principal pode configurar o envio Zoho.
      </p>
    );
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await saveZohoSelfClient({
        data: { code, clientId, clientSecret, dataCenter },
      });
      setCode("");
      setClientSecret("");
      setClientId("");
      toast.success(`Ligação Zoho validada para ${result.sender}`);
      await qc.invalidateQueries({ queryKey: ["zoho-mail-status"] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3 border-b pb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Entrega de ingressos
        </p>
        <h1 className="text-3xl font-bold">E-mail Zoho</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ligue a caixa comercial para enviar ingressos digitais e confirmações através da API Zoho
          Mail.
        </p>
      </header>

      <section className="flex items-start gap-4 border-b pb-6">
        {statusQuery.data?.connected ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        ) : (
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="space-y-1">
          <p className="font-medium">
            {statusQuery.data?.connected ? "Conta ligada" : "Conta ainda não ligada"}
          </p>
          <p className="text-sm text-muted-foreground">
            Remetente: <b>mytickets@macroyetu.com</b>
            {statusQuery.data?.connected && statusQuery.data.updatedAt
              ? ` · atualizada ${new Date(statusQuery.data.updatedAt).toLocaleString("pt-AO")}`
              : ""}
          </p>
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <h2 className="font-semibold">Passo-a-passo (cerca de 3 minutos)</h2>
        </div>
        <ol className="space-y-4 text-sm">
          <li className="rounded-lg border p-4"><b>1. Entre na consola do Zoho</b><p className="mt-1 text-muted-foreground">Abra <a className="text-primary underline" href="https://api-console.zoho.com" target="_blank" rel="noreferrer">api-console.zoho.com</a> com a conta que gere a caixa <b>mytickets@macroyetu.com</b>. Se o endereço mudar para <i>.eu</i> ou outro, escolha essa mesma região no passo 5.</p></li>
          <li className="rounded-lg border p-4"><b>2. Crie um “Self Client”</b><p className="mt-1 text-muted-foreground">Clique em <b>Add Client</b> → <b>Self Client</b> → <b>Create</b> → <b>OK</b>. Se já existir, clique nele.</p></li>
          <li className="rounded-lg border p-4"><b>3. Copie o Client ID e o Client Secret</b><p className="mt-1 text-muted-foreground">No separador <b>Client Secret</b>, copie os dois valores e cole-os nos campos abaixo. Se já os partilhou por mensagem, clique primeiro em <b>Regenerate</b> no Zoho para criar um secret novo.</p></li>
          <li className="rounded-lg border p-4"><b>4. Gere o code</b><p className="mt-1 text-muted-foreground">No separador <b>Generate Code</b>, cole este texto em <b>Scope</b>:</p>
            <div className="mt-2 flex gap-2"><code className="flex-1 break-all rounded bg-secondary px-3 py-2">ZohoMail.accounts.READ,ZohoMail.messages.CREATE</code><Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText("ZohoMail.accounts.READ,ZohoMail.messages.CREATE").then(() => toast.success("Scope copiado"))}>Copiar</Button></div>
            <p className="mt-2 text-muted-foreground">Em <b>Time Duration</b> escolha <b>10 minutes</b>, escreva qualquer descrição (ex.: MY Tickets) e clique em <b>Create</b>. Copie o code que aparece.</p></li>
          <li className="rounded-lg border p-4"><b>5. Cole tudo aqui e clique em “Ligar Zoho Mail”</b><p className="mt-1 text-muted-foreground">Faça-o logo — o code expira em 10 minutos e só funciona uma vez. Se aparecer “code inválido”, volte ao passo 4 e gere outro.</p></li>
        </ol>


        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="zoho-region">Região da conta Zoho</Label>
              <select
                id="zoho-region"
                value={dataCenter}
                onChange={(event) => setDataCenter(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {DATA_CENTERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="zoho-client-id">Client ID</Label>
              <Input
                id="zoho-client-id"
                autoComplete="off"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="zoho-client-secret">Client Secret</Label>
            <Input
              id="zoho-client-secret"
              type="password"
              autoComplete="new-password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zoho-code">Self Client code</Label>
            <Input
              id="zoho-code"
              type="password"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ao clicar, confirmamos o acesso à caixa <b>mytickets@macroyetu.com</b> e guardamos os
            dados de forma cifrada. Eles não voltam a aparecer nesta página.
          </p>
          <Button type="submit" disabled={saving}>
            {saving
              ? "A validar e guardar…"
              : statusQuery.data?.connected
                ? "Atualizar ligação Zoho"
                : "Ligar Zoho Mail"}
          </Button>
        </form>
      </section>
    </div>
  );
}
