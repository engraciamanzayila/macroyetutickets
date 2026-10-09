import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Copy, Download, PenTool, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { artUrl, generate, type Group, type OutputFormat } from "@/lib/generate";
import { UploadPanel } from "@/components/event/UploadPanel";
import { TicketsPanel } from "@/components/event/TicketsPanel";
import { ReportPanel } from "@/components/event/ReportPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContractPanel } from "@/components/event/ContractPanel";
import { useAuth } from "@/lib/auth";
import { APPROVAL_LABEL } from "@/lib/company";

export const Route = createFileRoute("/_app/eventos/$eventId")({
  head: () => ({
    meta: [
      { title: "Evento — MACRO YETU TICKETs" },
      { name: "description", content: "Grupos de ingressos, geração e relatórios do evento." },
      { property: "og:title", content: "Evento — MACRO YETU TICKETs" },
      { property: "og:description", content: "Grupos de ingressos, geração e relatórios do evento." },
    ],
  }),
  component: EventPage,
});

function Thumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (path) artUrl(path).then(setUrl); }, [path]);
  return <div className="h-16 w-24 rounded-md checker grid place-items-center overflow-hidden shrink-0">{url && <img src={url} alt="" className="max-h-full max-w-full object-contain" />}</div>;
}

function EventPage() {
  const { eventId } = Route.useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: event } = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => (await supabase.from("events").select("*").eq("id", eventId).single()).data,
  });
  const { data: groups = [] } = useQuery({
    queryKey: ["groups", eventId],
    queryFn: async () => {
      const { data } = await supabase.from("ticket_groups").select("*, tickets(count)").eq("event_id", eventId).order("created_at");
      return (data ?? []) as unknown as (Group & { tickets: { count: number }[]; source_filename: string | null })[];
    },
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genOpen, setGenOpen] = useState(false);
  const [formats, setFormats] = useState<OutputFormat[]>(["zip"]);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["groups", eventId] });

  const updateGroup = async (id: string, patch: Partial<Group>) => {
    const { error } = await supabase.from("ticket_groups").update(patch as never).eq("id", id);
    if (error) toast.error(error.message);
    refresh();
  };
  const deleteGroup = async (g: Group) => {
    if (!confirm(`Apagar o grupo "${g.name}" e todos os seus ingressos?`)) return;
    await supabase.from("ticket_groups").delete().eq("id", g.id);
    if (g.art_path) await supabase.storage.from("arts").remove([g.art_path]);
    refresh();
  };
  const copyLayoutToSameSize = async (g: Group) => {
    if (!g.layout) return toast.error("Este grupo ainda não tem QR posicionado.");
    const targets = groups.filter((x) => x.id !== g.id && x.art_width && g.art_width && Math.abs(x.art_width / (x.art_height ?? 1) - g.art_width / (g.art_height ?? 1)) < 0.01);
    for (const t of targets) await supabase.from("ticket_groups").update({ layout: g.layout as never }).eq("id", t.id);
    toast.success(`Posição aplicada a ${targets.length} grupo(s) com o mesmo formato`);
    refresh();
  };

  const runGenerate = async () => {
    const chosen = groups.filter((g) => selected.has(g.id));
    const noLayout = chosen.filter((g) => !g.layout);
    if (noLayout.length) return toast.error(`Posicione o QR primeiro em: ${noLayout.map((g) => g.name).join(", ")}`);
    try {
      setProgress({ done: 0, total: 1, label: "A iniciar…" });
      const n = await generate(chosen, formats, `${event?.name ?? "evento"}${chosen.length === 1 ? "_" + chosen[0].name : ""}`, (done, total, label) => setProgress({ done, total, label }));
      toast.success(`${n} ingressos gerados`);
      setGenOpen(false);
      refresh();
      qc.invalidateQueries({ queryKey: ["tickets", eventId] });
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar: " + (e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const totalPlanned = groups.reduce((s, g) => s + g.quantity, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/eventos" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Eventos</Link>
        <h1 className="text-3xl font-bold mt-2">{event?.name}</h1>
        <p className="text-muted-foreground text-sm">{groups.length} grupos · {totalPlanned} ingressos planeados{event && <> · <Badge variant="secondary">{APPROVAL_LABEL[event.approval_status] ?? event.approval_status}</Badge></>}</p>
      </div>

      <Tabs defaultValue="grupos">
        <TabsList className="max-w-full overflow-x-auto justify-start">
          <TabsTrigger value="grupos">Grupos & geração</TabsTrigger>
          <TabsTrigger value="ingressos">Ingressos</TabsTrigger>
          <TabsTrigger value="relatorio">Relatório</TabsTrigger>
          <TabsTrigger value="contrato">Contrato & aprovação</TabsTrigger>
        </TabsList>
        <TabsContent value="contrato" className="mt-6">{event && <ContractPanel event={event} />}</TabsContent>

        <TabsContent value="grupos" className="space-y-6 mt-6">
          <UploadPanel eventId={eventId} onDone={refresh} />

          {groups.length > 0 && (
            <div className="rounded-2xl border bg-card">
              <div className="flex flex-wrap items-center gap-3 justify-between p-4 border-b">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.size === groups.length} onCheckedChange={(v) => setSelected(v ? new Set(groups.map((g) => g.id)) : new Set())} />
                  Selecionar todos
                </label>
                <Button disabled={!selected.size} onClick={() => setGenOpen(true)}><Download className="h-4 w-4" /> Gerar e baixar ({selected.size})</Button>
              </div>
              <div className="divide-y">
                {groups.map((g) => {
                  const made = g.tickets[0]?.count ?? 0;
                  return (
                    <div key={g.id} className="p-4 flex flex-wrap items-center gap-4">
                      <Checkbox checked={selected.has(g.id)} onCheckedChange={(v) => { const s = new Set(selected); v ? s.add(g.id) : s.delete(g.id); setSelected(s); }} />
                      <Thumb path={g.art_path} />
                      <div className="flex-1 min-w-[200px] space-y-1">
                        <Input defaultValue={g.name} disabled={made > 0} onBlur={(e) => e.target.value !== g.name && updateGroup(g.id, { name: e.target.value })} className="h-8 font-semibold" />
                        <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                          {made > 0 ? (
                            <Badge variant="secondary" title="Grupo já gerado — bloqueado">🔒 {g.ticket_type}</Badge>
                          ) : (
                            <select
                              value={g.ticket_type}
                              onChange={(e) => {
                                let v = e.target.value;
                                if (v === "__outro") { v = prompt("Novo tipo de ingresso:")?.trim() ?? ""; if (!v) return; }
                                updateGroup(g.id, { ticket_type: v });
                              }}
                              className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                            >
                              {Array.from(new Set(["Normal", "VIP", "VIP em pé", "Mesa", "Convite", "Staff", g.ticket_type])).map((t) => <option key={t} value={t}>{t}</option>)}
                              <option value="__outro">Outro…</option>
                            </select>
                          )}
                          {g.recipient && <span>→ {g.recipient}</span>}
                          {g.width_cm && <span>{g.width_cm}×{g.height_cm} cm</span>}
                          <span>{made} código(s) criados</span>
                          {!g.layout && <span className="text-warning">QR por posicionar</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Qtd</span>
                        <Input type="number" disabled={made > 0 && !isAdmin} title={made > 0 ? (isAdmin ? "Admin: aumente para gerar ingressos extra" : "Só a administração pode gerar extra") : undefined} min={made || 1} defaultValue={g.quantity} className="h-8 w-24" onBlur={(e) => { const q = parseInt(e.target.value); if (q && q !== g.quantity) updateGroup(g.id, { quantity: Math.max(q, made) }); }} />
                      </div>
                      <div className="flex gap-1">
                        {made === 0 && <Button asChild variant="secondary" size="sm"><Link to="/editor/$groupId" params={{ groupId: g.id }}><PenTool className="h-4 w-4" /> Editor</Link></Button>}
                        <Button variant="ghost" size="icon" title="Aplicar posição do QR aos grupos com o mesmo formato" onClick={() => copyLayoutToSameSize(g)}><Copy className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteGroup(g)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="ingressos" className="mt-6"><TicketsPanel eventId={eventId} groups={groups} /></TabsContent>
        <TabsContent value="relatorio" className="mt-6"><ReportPanel eventId={eventId} eventName={event?.name ?? ""} groups={groups} /></TabsContent>
      </Tabs>

      <Dialog open={genOpen} onOpenChange={(o) => !progress && setGenOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gerar ingressos</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Códigos já criados são reaproveitados — só criamos os que faltam para chegar à quantidade. Ingressos anulados não são incluídos.
          </p>
          <div className="space-y-3">
            {([
              ["zip", "ZIP de imagens", "Um JPG por ingresso, organizado por grupo"],
              ["pdf", "PDF único", "Um ingresso por página, no tamanho real"],
              ["a4", "Folha A4 com vários", "Vários ingressos por página para cortar"],
            ] as const).map(([v, t, d]) => (
              <label key={v} className="flex gap-3 items-start rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary">
                <Checkbox checked={formats.includes(v)} onCheckedChange={(c) => setFormats(c ? [...formats, v] : formats.filter((f) => f !== v))} />
                <div><p className="font-medium text-sm">{t}</p><p className="text-xs text-muted-foreground">{d}</p></div>
              </label>
            ))}
          </div>
          {progress && (
            <div className="space-y-2">
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
              <p className="text-xs text-muted-foreground">{progress.label}</p>
            </div>
          )}
          <Button onClick={runGenerate} disabled={!formats.length || !!progress}>{progress ? "A gerar…" : "Gerar e baixar"}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
