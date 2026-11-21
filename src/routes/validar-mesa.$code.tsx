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
  result: "valid" | "void" | "not_found";
  event?: string;
  card_type?: "MESA" | "BOX";
  card_number?: number;
  category?: string;
  price?: number | null;
  holder_name?: string | null;
  capacity?: number | null;
  physical_identifier_type?: "MESA" | "BOX" | null;
  physical_identifier_number?: number | null;
};

function VerifyTableCard() {
  const { code } = Route.useParams();
  const token = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(code)
    ? code
    : null;
  const { data, isLoading, error } = useQuery({
    queryKey: ["verify-table-card", token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_table_card", { p_token: token! });
      if (error) throw error;
      return data as Verification;
    },
    retry: false,
  });

  const valid = data?.result === "valid";
  const title = isLoading ? "A verificar cartão…" : error ? "Não foi possível verificar" :
    valid ? "Cartão válido" : data?.result === "void" ? "Cartão anulado" : "Cartão não encontrado";

  return <main className="min-h-screen bg-background px-4 py-10">
    <section className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-2xl border bg-card p-7 text-center shadow-sm">
      <Logo />
      <Badge variant={valid ? "default" : "destructive"}>{title}</Badge>
      {isLoading ? <p className="text-sm text-muted-foreground">A consultar a autenticidade do cartão na plataforma.</p> :
       error ? <p className="text-sm text-destructive">{(error as Error).message}</p> :
       !token || data?.result === "not_found" ? <p className="text-sm text-muted-foreground">Este QR Code não corresponde a um cartão de mesa reconhecido pelo MY Tickets.</p> :
       <div className="w-full space-y-3 text-left">
         <p className="text-lg font-semibold text-center">{data?.event}</p>
         <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-sm">
           <div><p className="text-muted-foreground">Cartão</p><p className="font-bold">{data?.card_type} #{String(data?.card_number ?? "").padStart(2, "0")}</p></div>
           <div><p className="text-muted-foreground">Categoria</p><p className="font-bold">{data?.category || "—"}</p></div>
           <div className="col-span-2"><p className="text-muted-foreground">Responsável</p><p className="font-semibold">{data?.holder_name || "Não indicado"}</p></div>
           <div><p className="text-muted-foreground">Capacidade</p><p className="font-bold">{data?.capacity ?? "—"} pessoas</p></div>
           <div><p className="text-muted-foreground">Preço</p><p className="font-bold">{data?.price == null ? "—" : new Intl.NumberFormat("pt-AO").format(data.price) + " Kz"}</p></div>
           <div className="col-span-2"><p className="text-muted-foreground">Identificador físico associado</p><p className="font-bold">{data?.physical_identifier_type && data?.physical_identifier_number ? `${data.physical_identifier_type} ${String(data.physical_identifier_number).padStart(2, "0")}` : "Ainda não associado"}</p></div>
         </div>
       </div>}
      <p className="text-xs text-muted-foreground">Esta consulta confirma apenas a autenticidade do cartão. Não valida entrada, não consome o cartão e não altera o estado de qualquer ingresso.</p>
    </section>
  </main>;
}
