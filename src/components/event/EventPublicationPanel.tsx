import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Store, Globe, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  event: {
    id: string;
    name: string;
    slug: string | null;
    approval_status: string;
    published: boolean;
    owner_id: string | null;
  };
};

export function EventPublicationPanel({ event }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const publish = async (published: boolean) => {
    if (published && event.approval_status !== "approved") {
      return toast.error("A administração precisa aprovar o evento antes da publicação.");
    }
    const slug = event.slug ?? `${event.name
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${event.id.slice(0, 6)}`;
    setBusy(true);
    try {
      const { error } = await supabase.from("events").update({ published, slug }).eq("id", event.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["event", event.id] });
      await qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(published ? "Evento publicado na loja" : "Evento retirado da loja");
    } catch (error) {
      toast.error(`Não foi possível ${published ? "publicar" : "retirar"} o evento: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const url = event.slug ? `${window.location.origin}/e/${event.slug}` : null;
  return (
    <section className="max-w-3xl space-y-5 rounded-2xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3"><Globe className="h-6 w-6 text-primary" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Disponibilização na loja pública</h2>
          <p className="text-sm text-muted-foreground">Controla aqui a presença deste evento na loja e obtém o link directo para partilhar com o público.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-4">
        <span className="text-sm text-muted-foreground">Estado da aprovação:</span>
        <Badge variant={event.approval_status === "approved" ? "default" : "secondary"}>{event.approval_status === "approved" ? "Aprovado" : event.approval_status === "rejected" ? "Recusado" : "Pendente de aprovação"}</Badge>
        <span className="ml-auto text-sm text-muted-foreground">Loja:</span>
        <Badge variant={event.published ? "default" : "secondary"}>{event.published ? "Publicado" : "Não publicado"}</Badge>
      </div>
      {event.approval_status !== "approved" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Publicação ainda bloqueada</p>
          <p className="mt-1 text-muted-foreground">Aprova primeiro o evento no separador «Contrato & aprovação». Só depois poderás disponibilizá-lo na loja.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} variant={event.published ? "secondary" : "default"} onClick={() => void publish(!event.published)}>
            <Store className="h-4 w-4" /> {busy ? "A actualizar…" : event.published ? "Retirar da loja" : "Publicar na loja"}
          </Button>
        </div>
      )}
      {event.published && url && (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm font-semibold">Link público do evento</p>
          <p className="break-all rounded-md bg-muted p-3 text-sm">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" /> Abrir página pública</Button>
            <Button onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success("Link directo da loja copiado."))}><Copy className="h-4 w-4" /> Copiar link para partilha</Button>
          </div>
        </div>
      )}
    </section>
  );
}
