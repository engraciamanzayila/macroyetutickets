import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, MapPin, Plus, ShieldCheck, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/eventos/")({
  head: () => ({
    meta: [
      { title: "Eventos — MY Tickets" },
      { name: "description", content: "Lista de eventos e ingressos." },
      { property: "og:title", content: "Eventos — MY Tickets" },
      { property: "og:description", content: "Lista de eventos e ingressos." },
    ],
  }),
  component: Events,
});

function Events() {
  const { isManager, isAdmin, session } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*, ticket_groups(count), tickets(count)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const [open, setOpen] = useState(false);
  const pendingApproval = events.filter((event: any) =>
    event.approval_status !== "approved" && event.approval_status !== "rejected"
  );
  const approvedNotPublished = events.filter((event: any) =>
    event.approval_status === "approved" && !event.published
  );
  const [form, setForm] = useState({
    name: "",
    event_date: "",
    event_time: "",
    venue: "",
    city: "",
    category: "",
    description: "",
  });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: created, error } = await supabase.from("events").insert({
      name: form.name,
      event_date: form.event_date || null,
      event_time: form.event_time || null,
      venue: form.venue || null,
      city: form.city || null,
      category: form.category || null,
      description: form.description || null,
      created_by: session?.user.id,
      owner_id: session?.user.id,
    }).select("id").single();
    if (error) return toast.error(error.message);
    setOpen(false);
    setForm({ name: "", event_date: "", event_time: "", venue: "", city: "", category: "", description: "" });
    toast.success("Evento criado. Agora podes carregar os flyers e criar os grupos de ingressos.");
    await qc.invalidateQueries({ queryKey: ["events"] });
    await navigate({ to: "/eventos/$eventId", params: { eventId: created.id } });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Eventos</h1>
          <p className="text-muted-foreground">Crie um evento, carregue os flyers de divulgação e configure os ingressos.</p>
        </div>
        {isManager && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Novo evento</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo evento</DialogTitle></DialogHeader>
              <form onSubmit={create} className="space-y-4">
                <div className="space-y-2"><Label>Nome</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="This Is House Music" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Data</Label><Input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Hora</Label><Input type="time" value={form.event_time} onChange={(e) => setForm({ ...form, event_time: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Local</Label><Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Cidade</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>Categoria</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Música, festa, teatro…" /></div>
                <div className="space-y-2"><Label>Descrição</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
                <Button type="submit" className="w-full">Criar</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {isAdmin && (
        <section className="space-y-4 rounded-2xl border border-primary/20 bg-primary/[0.025] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold">Aprovação e disponibilização na loja</h2></div>
              <p className="mt-1 text-sm text-muted-foreground">Analise os eventos, associe uma conta de Promotor responsável e decida sobre a aprovação. A publicação na loja é uma etapa separada.</p>
            </div>
            <div className="flex gap-2 text-xs">
              <span className="rounded-full bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-700">{pendingApproval.length} por analisar</span>
              <span className="rounded-full bg-secondary px-3 py-1.5 font-semibold">{approvedNotPublished.length} aprovados não publicados</span>
            </div>
          </div>
          {pendingApproval.length === 0 && approvedNotPublished.length === 0 ? (
            <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Não existem eventos pendentes de aprovação ou publicação.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {pendingApproval.map((ev: any) => (
                <article key={ev.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><h3 className="font-bold">{ev.name}</h3><p className="mt-1 text-xs text-muted-foreground">{[ev.event_date ? new Date(ev.event_date).toLocaleDateString("pt-AO") : null, ev.venue, ev.city].filter(Boolean).join(" · ") || "Data e local por definir"}</p></div>
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700">Por aprovar</span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">Próximo passo: verificar os dados e o contrato, associar o Promotor responsável e aprovar ou recusar.</p>
                  <Button asChild size="sm" className="mt-4"><Link to="/eventos/$eventId" params={{ eventId: ev.id }}>Analisar evento</Link></Button>
                </article>
              ))}
              {approvedNotPublished.map((ev: any) => (
                <article key={ev.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><h3 className="font-bold">{ev.name}</h3><p className="mt-1 text-xs text-muted-foreground">{[ev.event_date ? new Date(ev.event_date).toLocaleDateString("pt-AO") : null, ev.venue, ev.city].filter(Boolean).join(" · ") || "Data e local por definir"}</p></div>
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">Aprovado · fora da loja</span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">A aprovação está concluída. Pode abrir o evento e decidir quando o disponibilizar publicamente.</p>
                  <Button asChild size="sm" variant="outline" className="mt-4"><Link to="/eventos/$eventId" params={{ eventId: ev.id }}><Store className="mr-2 h-4 w-4" />Gerir publicação</Link></Button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {isLoading ? (
        <p className="text-muted-foreground">A carregar…</p>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">Ainda não há eventos.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((ev) => (
            <Link key={ev.id} to="/eventos/$eventId" params={{ eventId: ev.id }} className="group rounded-2xl border bg-card p-5 hover:border-primary/60 transition-colors">
              <h3 className="text-xl font-bold group-hover:text-primary">{ev.name}</h3>
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                {ev.event_date && <span className="flex items-center gap-1"><CalendarDays className="h-4 w-4" />{new Date(ev.event_date).toLocaleDateString("pt-PT")}</span>}
                {ev.venue && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{ev.venue}</span>}
              </div>
              <div className="mt-4 flex gap-4 text-sm">
                <span><b>{(ev.ticket_groups as unknown as { count: number }[])[0]?.count ?? 0}</b> grupos</span>
                <span><b>{(ev.tickets as unknown as { count: number }[])[0]?.count ?? 0}</b> ingressos</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
