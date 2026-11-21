import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/validar-mesa/$code")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Validar cartão de mesa — MY Tickets" },
    { name: "robots", content: "noindex" },
  ] }),
  component: VerifyTableCard,
});

type Verification = {
  result: "valid" | "used" | "void" | "not_found";
  event?: string;
  table_number?: number;
  holder_name?: string | null;
  capacity?: number | null;
  group?: string;
  code?: string;
};

function VerifyTableCard() {
  const { code } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["verify-table-card", code],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_table_card", { p_code: code });
      if (error) throw error;
      return data as Verification;
    },
    retry: false,
  });

  const valid = data?.result === "valid";
  const title = isLoading ? "A verificar cartão…" : error ? "Não foi possível verificar" :
    valid ? "Cartão válido" : data?.result === "void" ? "Cartão anulado" :
    data?.result === "used" ? "Cartão já utilizado" : "Cartão não encontrado";

  return <main className="min-h-screen bg-background px-4 py-10">
    <section className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-2xl border bg-card p-7 text-center shadow-sm">
      <Logo />
      <Badge variant={valid ? "default" : "destructive"}>{title}</Badge>
      {isLoading ? <p className="text-sm text-muted-foreground">A consultar a validade na plataforma.</p> :
       error ? <p className="text-sm text-destructive">{(error as Error).message}</p> :
       data?.result === "not_found" ? <p className="text-sm text-muted-foreground">Este código não corresponde a um cartão de mesa reconhecido pelo MY Tickets.</p> :
       <div className="w-full space-y-3 text-left">
         <p className="text-lg font-semibold text-center">{data?.event}</p>
         <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-sm">
           <div><p className="text-muted-foreground">Mesa</p><p className="font-bold">#{data?.table_number}</p></div>
           <div><p className="text-muted-foreground">Capacidade</p><p className="font-bold">{data?.capacity ?? "—"} pessoas</p></div>
           <div className="col-span-2"><p className="text-muted-foreground">Responsável</p><p className="font-semibold">{data?.holder_name || "Não indicado"}</p></div>
           <div className="col-span-2"><p className="text-muted-foreground">Referência</p><p className="break-all font-mono text-xs">{data?.code}</p></div>
         </div>
       </div>}
      <p className="text-xs text-muted-foreground">Verificação de autenticidade do cartão. Esta consulta não regista entrada nem altera o estado do cartão.</p>
    </section>
  </main>;
}
