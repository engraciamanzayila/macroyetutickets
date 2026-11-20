import { createFileRoute, Link } from "@tanstack/react-router";
import { StoreHeader } from "@/components/store/StoreHeader";
import { Button } from "@/components/ui/button";
import { COMMISSION_EXCLUSIVE, COMMISSION_STANDARD } from "@/lib/company";
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
function Promoters() {
  return <><StoreHeader /><main className="mx-auto max-w-4xl px-5 py-12">
    <p className="text-primary">ESPAÇO DO PROMOTOR</p>
    <h1 className="mt-3 text-4xl font-bold">Os seus eventos na<br />MY Tickets</h1>
    <p className="mt-6 max-w-xl text-lg text-muted-foreground">O registo e a publicação são gratuitos. A comissão é de <strong className="text-foreground">{COMMISSION_STANDARD}%</strong> por ingresso vendido. Para eventos com exclusividade na MY Tickets, a comissão é reduzida para <strong className="text-foreground">{COMMISSION_EXCLUSIVE}%</strong>.</p>
    <p className="mt-5 text-muted-foreground">Para se candidatar, o promotor deverá preencher o formulário com os seus dados pessoais ou da empresa, informação legal, contactos e documentação. A candidatura será analisada pela equipa MY Tickets. O acesso de promotor e a publicação de eventos só são activados depois da aprovação e assinatura do contrato.</p>
    <div className="mt-8 flex flex-wrap gap-3"><Button asChild><Link to="/login">Aceder ao espaço do promotor</Link></Button><Button asChild variant="secondary"><Link to="/login">Iniciar candidatura</Link></Button></div>
  </main></>;
}