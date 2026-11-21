import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CarFront, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/livre-transito/$token")({ component: FreeTransitCheckIn });

function FreeTransitCheckIn() {
  const { token } = Route.useParams();
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: pass, refetch } = useQuery({
    queryKey: ["free-transit-pass", token],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("event_free_transit_passes").select("reference_code,status,vehicle_plate,events(name)").eq("qr_token", token).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const validate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("check_in_free_transit", { p_token: token, p_plate: plate.toUpperCase() });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data?.result === "ok") toast.success("Entrada autorizada. Matrícula associada.");
    else if (data?.result === "same_vehicle") toast.warning("Este passe já foi utilizado por esta matrícula.");
    else if (data?.result === "different_vehicle") toast.error("ACESSO RECUSADO: matrícula diferente da registada.");
    else toast.error("Passe inválido, cancelado ou não disponível.");
    await refetch();
  };
  return <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
    <div className="rounded-2xl border bg-card p-6 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 text-primary"><CarFront className="size-7" /></div>
      <p className="mt-4 text-xs font-bold tracking-[.2em] text-primary">THIS IS HOUSE MUSIC</p>
      <h1 className="mt-2 text-2xl font-black">Validação de livre-trânsito</h1>
      <p className="mt-2 text-sm text-muted-foreground">By MY Tickets</p>
      {pass ? <div className="mt-5 rounded-xl bg-muted p-4 text-left"><p className="text-xs text-muted-foreground">REFERÊNCIA</p><p className="font-mono text-xl font-bold">{pass.reference_code}</p><p className="mt-2 text-sm">Evento: {(pass.events as any)?.name ?? "THIS IS HOUSE MUSIC"}</p><p className="mt-1 text-sm">Estado: {pass.status === "active" ? "Disponível" : pass.status === "used" ? "Já utilizado" : "Cancelado"}</p>{pass.vehicle_plate && <p className="mt-1 text-sm font-semibold">Matrícula associada: {pass.vehicle_plate}</p>}</div> : <p className="mt-5 text-sm text-muted-foreground">A carregar ou passe não encontrado…</p>}
    </div>
    {pass?.status === "active" && <form onSubmit={validate} className="space-y-4 rounded-2xl border bg-card p-6"><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-primary" /> Registar matrícula</div><label className="block space-y-2 text-sm font-medium">Matrícula da viatura<input required minLength={5} maxLength={14} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="LD-12-34-AB" className="h-12 w-full rounded-md border bg-background px-3 text-lg font-mono uppercase" /></label><Button className="w-full" disabled={busy}>{busy ? "A validar…" : "Confirmar entrada"}</Button><p className="text-xs text-muted-foreground">A primeira matrícula registada fica associada ao passe. Não será possível utilizá-lo com outra viatura.</p></form>}
  </main>;
}
