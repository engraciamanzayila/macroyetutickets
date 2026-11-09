import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Copy, Download, PenTool, Printer, Trash2 } from "lucide-react";
import { PrintDialog } from "@/components/event/PrintDialog";
import { supabase } from "@/integrations/supabase/client";
import { artUrl, fetchAllTickets, generate, type Group, type OutputFormat } from "@/lib/generate";
import { UploadPanel } from "@/components/event/UploadPanel";
import { TicketsPanel } from "@/components/event/TicketsPanel";
import { ReportPanel } from "@/components/event/ReportPanel";
import { SharesPanel } from "@/components/event/SharesPanel";
import { AdminDispatchPanel } from "@/components/event/AdminDispatchPanel";
import { TablesPanel } from "@/components/event/TablesPanel";
import { PrintHistoryPanel } from "@/components/event/PrintHistoryPanel";
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
import { kz } from "@/lib/payments";

export const Route = createFileRoute("/_app/eventos/$eventId")({
  head: () => ({
    meta: [
      { title: "Evento — MY Tickets" },
      { name: "description", content: "Grupos de ingressos, geração e relatórios do evento." },
      { property: "og:title", content: "Evento — MY Tickets" },
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
  const { data: ticketDistribution = {} } = useQuery({
    queryKey: ["ticket-distribution", eventId],
    queryFn: async () => {
      const tickets = await fetchAllTickets({ event_id: eventId });
      return tickets.reduce<Record<string, { free: number; distributed: number; printed: number; sending: number }>>((counts, ticket) => {
        const current = counts[ticket.group_id] ?? { free: 0, distributed: 0, printed: 0, sending: 0 };
        if (ticket.printed_at) current.printed++;
        else if (ticket.sent_at || ticket.share_id || ticket.email_delivery_status === "sent") current.distributed++;
        else if (ticket.email_delivery_status === "sending") current.sending++;
        else if (ticket.status === "valid") current.free++;
        counts[ticket.group_id] = current;
        return counts;
      }, {});
    },
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genOpen, setGenOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [formats, setFormats] = useState<OutputFormat[]>(["pdf"]);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const selectedGroupIds = useMemo(
    () => groups.filter((group) => selected.has(group.id)).map((group) => group.id),
    [groups, selected],
  );

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
      qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] });
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
          {groups.some((g) => g.ticket_type.toUpperCase().includes("MESA")) && <TabsTrigger value="mesas">Mesas</TabsTrigger>}
          <TabsTrigger value="ingressos">Ingressos</TabsTrigger>
          <TabsTrigger value="impressoes">Impressões</TabsTrigger>
          <TabsTrigger value="relatorio">Relatório</TabsTrigger>
          <TabsTrigger value="partilha">Partilha</TabsTrigger>
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
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setPrintOpen(true)}><Printer className="h-4 w-4" /> Exportar para impressão</Button>
                  <Button disabled={!selected.size} onClick={() => setGenOpen(true)}><Download className="h-4 w-4" /> Baixar digitais ({selected.size})</Button>
                </div>
              </div>
              <div className="divide-y">
                {groups.map((g) => {
                  const made = g.tickets[0]?.count ?? 0;
                  return (
                    <div key={g.id} className="p-4 flex flex-wrap items-center gap-4">
                      <Checkbox checked={selected.has(g.id)} onCheckedChange={(v) => { const s = new Set(selected); if (v) s.add(g.id); else s.delete(g.id); setSelected(s); }} />
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
                          {g.price != null && g.price > 0 && <span>{kz(g.price)}</span>}
                          {g.width_cm && <span>{g.width_cm}×{g.height_cm} cm</span>}
                          <span className="font-medium text-foreground">{ticketDistribution[g.id]?.free ?? 0} mesa(s) disponível(is)</span>
                          <span>{ticketDistribution[g.id]?.distributed ?? 0} distribuída(s)</span>
                          <span>{ticketDistribution[g.id]?.printed ?? 0} impressa(s)</span>
                          {(ticketDistribution[g.id]?.sending ?? 0) > 0 ? <span>{ticketDistribution[g.id]?.sending} em envio</span> : null}
                          <span title="Total de códigos já criados">{made} código(s) criados no total</span>
                          {!g.layout && <span className="text-warning">QR por posicionar</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 pt-2">
                          <label className="flex items-center gap-2 text-xs">
                            <Checkbox checked={!!g.for_sale} onCheckedChange={(value) => updateGroup(g.id, { for_sale: !!value })} />
                            À venda na loja pública
                          </label>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`Preço por ingresso de ${g.name} em Kz`}
                            defaultValue={g.price ?? 0}
                            onBlur={(e) => {
                              const price = Number(e.target.value);
                              if (Number.isFinite(price) && price >= 0 && price !== (g.price ?? 0)) updateGroup(g.id, { price });
                            }}
                            className="h-8 w-32"
                            placeholder="Preço Kz"
                          />
                          <span className="text-xs text-muted-foreground">Kz / ingresso</span>
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

        {groups.some((g) => g.ticket_type.toUpperCase().includes("MESA")) && (
          <TabsContent value="mesas" className="mt-6">
            <TablesPanel eventId={eventId} eventName={event?.name ?? "Evento"} groups={groups} />
          </TabsContent>
        )}
        <TabsContent value="ingressos" className="mt-6"><TicketsPanel eventId={eventId} groups={groups} /></TabsContent>
        <TabsContent value="impressoes" className="mt-6"><PrintHistoryPanel eventId={eventId} eventName={event?.name ?? "Evento"} groups={groups} /></TabsContent>
        <TabsContent value="partilha" className="mt-6"><AdminDispatchPanel eventId={eventId} eventName={event?.name ?? "evento"} groups={groups} /><SharesPanel eventId={eventId} groups={groups} /></TabsContent>
        <TabsContent value="relatorio" className="mt-6"><ReportPanel eventId={eventId} eventName={event?.name ?? ""} groups={groups} /></TabsContent>
      </Tabs>

      <PrintDialog open={printOpen} onOpenChange={setPrintOpen} eventId={eventId} eventName={event?.name ?? "evento"} groups={groups} initialGroupIds={selectedGroupIds} onDone={() => { setSelected(new Set()); refresh(); qc.invalidateQueries({ queryKey: ["tickets", eventId] }); qc.invalidateQueries({ queryKey: ["ticket-distribution", eventId] }); }} />

      <Dialog open={genOpen} onOpenChange={(o) => !progress && setGenOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gerar ingressos</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Códigos já criados são reaproveitados — só criamos os que faltam para chegar à quantidade. Ingressos anulados ou já enviados para impressão não são incluídos. Cada ficheiro digital inclui evento, grupo, referência e titular no nome; várias entradas são entregues num ZIP.
          </p>
          <div className="space-y-3">
            {([
              ["pdf", "PDF por ingresso", "Ficheiros PDF individuais, identificados por referência e titular"],
              ["jpeg", "JPEG", "Uma imagem JPG por ingresso"],
              ["png", "PNG", "Uma imagem PNG por ingresso"],
              ["tiff", "TIFF", "Uma imagem TIFF por ingresso"],
              ["a4", "Folha A4 para impressão (PDF)", "Gera também uma folha A4 paginada para a gráfica"],
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
