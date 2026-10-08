import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, MapPin, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/eventos/")({
  head: () => ({
    meta: [
      { title: "Eventos — MACRO YETU TICKETs" },
      { name: "description", content: "Lista de eventos e ingressos." },
      { property: "og:title", content: "Eventos — MACRO YETU TICKETs" },
      { property: "og:description", content: "Lista de eventos e ingressos." },
    ],
  }),
  component: Events,
});

function Events() {
  const { isManager, session } = useAuth();
  const qc = useQueryClient();
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*, ticket_groups(count), tickets(count)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", event_date: "", venue: "" });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("events").insert({
      name: form.name,
      event_date: form.event_date || null,
      venue: form.venue || null,
      created_by: session?.user.id,
      owner_id: session?.user.id,
    });
    if (error) return toast.error(error.message);
    setOpen(false);
    setForm({ name: "", event_date: "", venue: "" });
    qc.invalidateQueries({ queryKey: ["events"] });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Eventos</h1>
          <p className="text-muted-foreground">Crie um evento e carregue as artes dos ingressos.</p>
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
                  <div className="space-y-2"><Label>Local</Label><Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></div>
                </div>
                <Button type="submit" className="w-full">Criar</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
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
