import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, CameraOff, CloudOff, Download, RefreshCw, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllTickets } from "@/lib/generate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/portaria")({
  head: () => ({
    meta: [
      { title: "Portaria — MACRO YETU TICKETs" },
      { name: "description", content: "Leitura de QR e validação de ingressos na entrada do evento." },
      { property: "og:title", content: "Portaria — MACRO YETU TICKETs" },
      { property: "og:description", content: "Validação de ingressos na entrada." },
    ],
  }),
  component: Gate,
});

type CacheTicket = { s: string; g: string; at?: string | null };
type Cache = { savedAt: string; groups: Record<string, { name: string; type: string; recipient: string | null }>; tickets: Record<string, CacheTicket> };
type QueueItem = { event: string; code: string; at: string };
type Result = { result: "ok" | "used" | "void" | "not_found"; code: string; group?: string; type?: string; recipient?: string | null; used_at?: string | null; offline?: boolean };

const cacheKey = (e: string) => `myt-cache-${e}`;
const QUEUE = "myt-queue";
const readQueue = (): QueueItem[] => JSON.parse(localStorage.getItem(QUEUE) || "[]");
const writeQueue = (q: QueueItem[]) => localStorage.setItem(QUEUE, JSON.stringify(q));

function Gate() {
  const [eventId, setEventId] = useState<string>(() => localStorage.getItem("myt-event") || "");
  const [online, setOnline] = useState(navigator.onLine);
  const [cache, setCache] = useState<Cache | null>(null);
  const [queueLen, setQueueLen] = useState(readQueue().length);
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState("");
  const [camOn, setCamOn] = useState(false);
  const [count, setCount] = useState(0);
  const scanner = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const last = useRef<{ code: string; t: number }>({ code: "", t: 0 });

  const { data: events = [] } = useQuery({
    queryKey: ["events-min"],
    queryFn: async () => (await supabase.from("events").select("id,name,event_date").order("created_at", { ascending: false })).data ?? [],
  });

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    if (!eventId) return;
    localStorage.setItem("myt-event", eventId);
    const raw = localStorage.getItem(cacheKey(eventId));
    setCache(raw ? JSON.parse(raw) : null);
  }, [eventId]);

  const downloadCache = useCallback(async () => {
    if (!eventId) return;
    try {
      const [{ data: groups }, tickets] = await Promise.all([
        supabase.from("ticket_groups").select("id,name,ticket_type,recipient").eq("event_id", eventId),
        fetchAllTickets({ event_id: eventId }, "code,status,group_id,used_at"),
      ]);
      const c: Cache = { savedAt: new Date().toISOString(), groups: {}, tickets: {} };
      for (const g of groups ?? []) c.groups[g.id] = { name: g.name, type: g.ticket_type, recipient: g.recipient };
      for (const t of tickets) c.tickets[t.code] = { s: t.status, g: t.group_id, at: t.used_at };
      // keep local offline entries that weren't synced yet
      for (const q of readQueue().filter((q) => q.event === eventId)) if (c.tickets[q.code]?.s === "valid") c.tickets[q.code] = { ...c.tickets[q.code], s: "used", at: q.at };
      localStorage.setItem(cacheKey(eventId), JSON.stringify(c));
      setCache(c);
      toast.success(`${tickets.length} ingressos guardados para uso sem internet`);
    } catch (e) {
      toast.error("Não foi possível baixar: " + (e as Error).message);
    }
  }, [eventId]);

  const sync = useCallback(async () => {
    const q = readQueue();
    if (!q.length || !navigator.onLine) return;
    const left: QueueItem[] = [];
    for (const item of q) {
      const { error } = await supabase.rpc("check_in", { p_event: item.event, p_code: item.code, p_at: item.at });
      if (error) left.push(item);
    }
    writeQueue(left);
    setQueueLen(left.length);
    if (q.length - left.length > 0) toast.success(`${q.length - left.length} entrada(s) sincronizadas`);
  }, []);

  useEffect(() => {
    if (online) void sync();
    const i = setInterval(() => navigator.onLine && sync(), 30000);
    return () => clearInterval(i);
  }, [online, sync]);

  const updateLocal = (code: string, patch: CacheTicket) => {
    setCache((c) => {
      if (!c) return c;
      const next = { ...c, tickets: { ...c.tickets, [code]: patch } };
      localStorage.setItem(cacheKey(eventId), JSON.stringify(next));
      return next;
    });
  };

  const validate = useCallback(async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code || !eventId) return;
    const now = Date.now();
    if (last.current.code === code && now - last.current.t < 3000) return;
    last.current = { code, t: now };

    let r: Result | null = null;
    if (navigator.onLine) {
      const { data, error } = await supabase.rpc("check_in", { p_event: eventId, p_code: code });
      if (!error && data) {
        r = data as unknown as Result;
        r.code = r.code ?? code;
        const local = cache?.tickets[code];
        if (local && r.result === "ok") updateLocal(code, { ...local, s: "used", at: new Date().toISOString() });
      }
    }
    if (!r) {
      const t = cache?.tickets[code];
      const g = t ? cache?.groups[t.g] : undefined;
      if (!cache) { toast.error("Sem internet e sem lista guardada. Baixe a lista antes do evento."); return; }
      if (!t) r = { result: "not_found", code, offline: true };
      else if (t.s === "void") r = { result: "void", code, group: g?.name, type: g?.type, recipient: g?.recipient, offline: true };
      else if (t.s === "used") r = { result: "used", code, group: g?.name, type: g?.type, recipient: g?.recipient, used_at: t.at, offline: true };
      else {
        const at = new Date().toISOString();
        updateLocal(code, { ...t, s: "used", at });
        const q = [...readQueue(), { event: eventId, code, at }];
        writeQueue(q);
        setQueueLen(q.length);
        r = { result: "ok", code, group: g?.name, type: g?.type, recipient: g?.recipient, offline: true };
      }
    }
    if (r.result === "ok") setCount((c) => c + 1);
    navigator.vibrate?.(r.result === "ok" ? 80 : [200, 80, 200]);
    setResult(r);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, cache]);

  const validateRef = useRef(validate);
  validateRef.current = validate;

  const startCam = async () => {
    const { Html5Qrcode } = await import("html5-qrcode");
    const s = new Html5Qrcode("qr-reader");
    scanner.current = s as never;
    try {
      await s.start({ facingMode: "environment" }, { fps: 12, qrbox: (w, h) => { const m = Math.min(w, h) * 0.7; return { width: m, height: m }; } }, (text) => validateRef.current(text), () => {});
      setCamOn(true);
    } catch (e) {
      toast.error("Não foi possível abrir a câmara: " + (e as Error).message);
    }
  };
  const stopCam = async () => {
    try { await scanner.current?.stop(); scanner.current?.clear(); } catch { /* ignore */ }
    setCamOn(false);
  };
  useEffect(() => () => { void stopCam(); }, []);

  const tone = result
    ? result.result === "ok" ? "bg-success text-success-foreground" : result.result === "used" ? "bg-warning text-warning-foreground" : "bg-destructive text-destructive-foreground"
    : "bg-card";
  const title = result ? { ok: "ENTRADA LIBERADA", used: "JÁ FOI USADO", void: "INGRESSO ANULADO", not_found: "NÃO ENCONTRADO" }[result.result] : "Pronto para ler";

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h1 className="text-3xl font-bold">Portaria</h1>
        <div className="flex items-center gap-3 text-sm">
          {online ? <span className="flex items-center gap-1 text-success"><Wifi className="h-4 w-4" /> Online</span> : <span className="flex items-center gap-1 text-warning"><CloudOff className="h-4 w-4" /> Sem internet</span>}
          {queueLen > 0 && <span className="text-warning">{queueLen} por sincronizar</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={eventId} onChange={(e) => { setEventId(e.target.value); setResult(null); }} className="h-10 flex-1 min-w-[200px] rounded-md border border-input bg-transparent px-3">
          <option value="" className="bg-popover">Escolha o evento…</option>
          {events.map((e) => <option key={e.id} value={e.id} className="bg-popover">{e.name}</option>)}
        </select>
        <Button variant="secondary" onClick={downloadCache} disabled={!eventId || !online}>
          {cache ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />} {cache ? "Atualizar lista" : "Baixar para modo offline"}
        </Button>
      </div>
      {cache && <p className="text-xs text-muted-foreground -mt-3">Lista offline: {Object.keys(cache.tickets).length} ingressos · {new Date(cache.savedAt).toLocaleString("pt-PT")}</p>}

      {eventId && (
        <>
          <div className={`rounded-2xl p-6 text-center transition-colors ${tone}`}>
            <p className="text-3xl md:text-4xl font-display font-extrabold">{title}</p>
            {result && (
              <div className="mt-2 space-y-0.5">
                <p className="font-mono text-lg font-bold">{result.code}</p>
                {result.group && <p>{result.type} · {result.group}{result.recipient ? ` → ${result.recipient}` : ""}</p>}
                {result.used_at && <p className="text-sm opacity-80">Entrou às {new Date(result.used_at).toLocaleTimeString("pt-PT")}</p>}
                {result.offline && <p className="text-xs opacity-75">(validado sem internet)</p>}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-card overflow-hidden">
            <div id="qr-reader" className={camOn ? "w-full" : "hidden"} />
            <div className="p-4 flex gap-2">
              <Button className="flex-1" variant={camOn ? "secondary" : "default"} onClick={camOn ? stopCam : startCam}>
                {camOn ? <><CameraOff className="h-4 w-4" /> Parar câmara</> : <><Camera className="h-4 w-4" /> Ler QR com a câmara</>}
              </Button>
            </div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); last.current = { code: "", t: 0 }; void validate(manual); setManual(""); }} className="flex gap-2">
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Inserir código manualmente (ex: VIP-AB12-CD34)" className="h-12 font-mono uppercase" />
            <Button type="submit" className="h-12">Validar</Button>
          </form>
          <p className="text-sm text-muted-foreground text-center">Entradas neste aparelho: <b className="text-foreground">{count}</b></p>
        </>
      )}
    </div>
  );
}
