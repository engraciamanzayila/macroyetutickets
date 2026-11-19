import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Printer, Download, Trash2, RefreshCw, QrCode, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { processArt } from "@/lib/art";
import { parseCredentialFilename, type CredentialSize } from "@/lib/credential-filename";
import { DEFAULT_LAYOUT, randomCode, renderTicket } from "@/lib/render";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { CredentialLayoutEditor } from "@/components/event/CredentialLayoutEditor";

type Batch = {
  id: string; event_id: string; source_filename: string; event_name: string;
  group_name: string; credential_type: string; size_code: CredentialSize;
  width_mm: number; height_mm: number; quantity: number; art_path: string;
  art_width: number; art_height: number; qr_layout: { x?: number; y?: number; size?: number; code_x?: number; code_y?: number; qr_dark?: string; qr_light?: string; code_size?: number; code_color?: string; code_show?: boolean; code_bold?: boolean };
  created_at: string;
};
type Draft = {
  key: string; file: File; preview: string; blob: Blob; width: number; height: number;
  eventName: string; groupName: string; credentialType: string; size: CredentialSize;
  widthMm: number; heightMm: number; quantity: number;
};
type Credential = { id: string; code: string; seq: number; status: string };
type BatchEditForm = { event_name: string; group_name: string; credential_type: string; size_code: CredentialSize; width_mm: string; height_mm: string };

const sizeMm: Record<CredentialSize, [number, number]> = {
  A6: [105, 148], A5: [148, 210], A4: [210, 297], CUSTOM: [105, 148],
};
const safe = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 70) || "credenciais";

export function CredentialingPanel({ eventId, eventName }: { eventId: string; eventName: string }) {
  const { isAdmin } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [batchEdit, setBatchEdit] = useState<BatchEditForm | null>(null);
  const [savingBatchEdit, setSavingBatchEdit] = useState(false);
  const [layoutBatch, setLayoutBatch] = useState<Batch | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from("credential_batches")
      .select("*").eq("event_id", eventId).order("created_at", { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as Batch[];
    setBatches(rows);
    setQty((currentQty) => Object.fromEntries(rows.map((b) => [b.id, currentQty[b.id] ?? b.quantity])));
  }, [eventId]);

  const startBatchEdit = (batch: Batch) => {
    setEditingBatch(batch);
    setBatchEdit({ event_name: batch.event_name, group_name: batch.group_name, credential_type: batch.credential_type,
      size_code: batch.size_code, width_mm: String(batch.width_mm), height_mm: String(batch.height_mm) });
  };

  const saveBatchEdit = async () => {
    if (!isAdmin || !editingBatch || !batchEdit || savingBatchEdit) return;
    const event_name = batchEdit.event_name.trim();
    const group_name = batchEdit.group_name.trim();
    const credential_type = batchEdit.credential_type.trim();
    const [standardWidth, standardHeight] = sizeMm[batchEdit.size_code];
    const width_mm = batchEdit.size_code === "CUSTOM" ? Number(batchEdit.width_mm) : standardWidth;
    const height_mm = batchEdit.size_code === "CUSTOM" ? Number(batchEdit.height_mm) : standardHeight;
    if (!event_name || !group_name || !credential_type) return toast.error("Evento, grupo e tipo são obrigatórios.");
    if (!Number.isFinite(width_mm) || !Number.isFinite(height_mm) || width_mm <= 0 || height_mm <= 0)
      return toast.error("Indique largura e altura válidas em milímetros.");
    setSavingBatchEdit(true);
    try {
      const { error } = await supabase.from("credential_batches").update({ event_name, group_name, credential_type,
        size_code: batchEdit.size_code, width_mm, height_mm }).eq("id", editingBatch.id).eq("event_id", eventId);
      if (error) throw error;
      toast.success("Grupo atualizado. Os códigos e QR Codes existentes foram preservados.");
      setEditingBatch(null); setBatchEdit(null); await refresh();
    } catch (error) {
      toast.error("Não foi possível atualizar o grupo: " + (error as Error).message);
    } finally { setSavingBatchEdit(false); }
  };

  useEffect(() => { void refresh().catch((e) => toast.error("Não foi possível carregar credenciais: " + e.message)); }, [refresh]);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.(png|jpe?g|webp|tiff?|pdf)$/i.test(f.name));
    if (!list.length) return toast.error("Escolha ficheiros PDF, PNG, JPG, WEBP ou TIFF.");
    if (list.length > 100) toast.warning("O limite por carregamento é 100 ficheiros. Serão usados os primeiros 100.");
    setLoading(true);
    for (const file of list.slice(0, 100)) {
      try {
        const parsed = parseCredentialFilename(file.name);
        const art = await processArt(file);
        const [w, h] = sizeMm[parsed.size];
        const draft: Draft = {
          key: crypto.randomUUID(), file, preview: art.previewUrl, blob: art.blob,
          width: art.width, height: art.height,
          eventName: parsed.eventName || eventName,
          groupName: parsed.groupName, credentialType: parsed.credentialType,
          size: parsed.size, widthMm: w, heightMm: h, quantity: parsed.quantity,
        };
        setDrafts((prev) => [...prev, draft]);
      } catch (e) {
        toast.error(file.name + ": " + (e as Error).message);
      }
    }
    setLoading(false);
  };

  const updateDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => d.key === key ? { ...d, ...patch } : d));

  const createCodes = async (batch: Batch, amount: number, startSeq: number) => {
    const rows = Array.from({ length: amount }, (_, i) => ({
      event_id: eventId, batch_id: batch.id, code: randomCode("CRD"), seq: startSeq + i,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("credentials").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
  };

  const saveDrafts = async () => {
    if (!drafts.length || saving) return;
    setSaving(true);
    let saved = 0;
    try {
      for (const d of drafts) {
        const id = crypto.randomUUID();
        const path = `${eventId}/credentials/${id}.png`;
        const { error: uploadError } = await supabase.storage.from("arts").upload(path, d.blob, { contentType: "image/png", upsert: false });
        if (uploadError) throw uploadError;
        const { data: user } = await supabase.auth.getUser();
        const payload = {
          id, event_id: eventId, source_filename: d.file.name, event_name: d.eventName,
          group_name: d.groupName, credential_type: d.credentialType, size_code: d.size,
          width_mm: d.widthMm, height_mm: d.heightMm, quantity: d.quantity,
          art_path: path, art_width: d.width, art_height: d.height,
          qr_layout: { x: 0.82, y: 0.78, size: 0.18 }, created_by: user.user?.id ?? null,
        };
        const { data: batch, error } = await supabase.from("credential_batches").insert(payload).select("*").single();
        if (error || !batch) {
          await supabase.storage.from("arts").remove([path]);
          throw error ?? new Error("Não foi possível criar o grupo de credenciais.");
        }
        await createCodes(batch as Batch, d.quantity, 1);
        saved++;
      }
      toast.success(`${saved} grupo(s) de credenciais criados.`);
      setDrafts([]);
      await refresh();
    } catch (e) {
      toast.error("Falha ao criar credenciais: " + (e as Error).message);
    } finally { setSaving(false); }
  };

  const selectedBatches = useMemo(() => batches.filter((b) => selected.has(b.id)), [batches, selected]);

  const changeQuantity = async (batch: Batch) => {
    const target = Math.max(0, Math.min(10000, Math.floor(qty[batch.id] ?? batch.quantity)));
    if (target === 0) return void deleteBatch(batch);
    const { data, error } = await supabase.from("credentials").select("id,seq,status").eq("batch_id", batch.id).order("seq", { ascending: true });
    if (error) return toast.error(error.message);
    const rows = (data ?? []) as { id: string; seq: number; status: string }[];
    const used = rows.filter((r) => r.status === "used").length;
    if (target < used) return toast.error(`Não é possível reduzir abaixo de ${used}: já foram utilizadas.`);
    if (target < rows.length) {
      const remove = rows.filter((r) => r.status === "valid").sort((a,b) => b.seq-a.seq).slice(0, rows.length-target).map((r) => r.id);
      if (remove.length) {
        const { error: deleteError } = await supabase.from("credentials").delete().in("id", remove);
        if (deleteError) return toast.error(deleteError.message);
      }
    } else if (target > rows.length) {
      const { data: full, error: readError } = await supabase.from("credential_batches").select("*").eq("id", batch.id).single();
      if (readError) return toast.error(readError.message);
      await createCodes(full as Batch, target - rows.length, rows.reduce((m,r) => Math.max(m,r.seq),0) + 1);
    }
    const { error: updateError } = await supabase.from("credential_batches").update({ quantity: target }).eq("id", batch.id);
    if (updateError) return toast.error(updateError.message);
    toast.success("Quantidade atualizada.");
    await refresh();
  };

  const saveQrLayout = async (batch: Batch, patch: { x?: number; y?: number; size?: number }) => {
    const next = { ...batch.qr_layout, x: batch.qr_layout?.x ?? 0.82, y: batch.qr_layout?.y ?? 0.78, size: batch.qr_layout?.size ?? 0.18, ...patch };
    const { error } = await supabase.from("credential_batches").update({ qr_layout: next }).eq("id", batch.id);
    if (error) return toast.error("Não foi possível guardar a posição do QR: " + error.message);
    setBatches((prev) => prev.map((item) => item.id === batch.id ? { ...item, qr_layout: next } : item));
    toast.success("Posição do QR guardada.");
  };

  const saveCodeLayout = async (batch: Batch, patch: { code_x?: number; code_y?: number }) => {
    const next = { ...batch.qr_layout, code_x: batch.qr_layout?.code_x ?? 0.87, code_y: batch.qr_layout?.code_y ?? 0.85, ...patch };
    const { error } = await supabase.from("credential_batches").update({ qr_layout: next }).eq("id", batch.id);
    if (error) return toast.error("Não foi possível guardar a posição do código: " + error.message);
    setBatches((prev) => prev.map((item) => item.id === batch.id ? { ...item, qr_layout: next } : item));
    toast.success("Posição do código guardada.");
  };

  const deleteBatch = async (batch: Batch) => {
    if (!confirm(`Eliminar o grupo "${batch.group_name}" e todos os seus QR Codes?`)) return;
    const { error } = await supabase.from("credential_batches").delete().eq("id", batch.id);
    if (error) return toast.error(error.message);
    await supabase.storage.from("arts").remove([batch.art_path]);
    setSelected((s) => { const next = new Set(s); next.delete(batch.id); return next; });
    await refresh();
    toast.success("Grupo eliminado.");
  };

  const buildOutput = async (mode: "pdf" | "images", batchOverride?: Batch[], quantityOverride?: Record<string, number>) => {
    const exportBatches = batchOverride ?? selectedBatches;
    if (!exportBatches.length) return toast.error("Selecione pelo menos um grupo.");
    setLoading(true); setProgress(0);
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let total = 0, done = 0, pageOpen = false;
      const items: { batch: Batch; credential: Credential }[] = [];
      for (const batch of exportBatches) {
        const amount = Math.max(0, Math.floor(quantityOverride?.[batch.id] ?? qty[batch.id] ?? batch.quantity));
        const { data, error } = await supabase.from("credentials")
          .select("id,code,seq,status").eq("batch_id", batch.id).eq("status", "valid").order("seq", { ascending: true }).limit(amount);
        if (error) throw error;
        for (const credential of (data ?? []) as Credential[]) items.push({ batch, credential });
      }
      total = items.length;
      if (!total) throw new Error("Não há credenciais válidas para exportar.");
      const artCache = new Map<string, ImageBitmap>();
      let pageSlot = 0, currentSize = "";
      try {
        for (const { batch, credential } of items) {
          let art = artCache.get(batch.id);
          if (!art) {
            const { data, error } = await supabase.storage.from("arts").download(batch.art_path);
            if (error || !data) throw error ?? new Error("Arte da credencial não encontrada.");
            art = await createImageBitmap(data); artCache.set(batch.id, art);
          }
          const layout = {
            ...DEFAULT_LAYOUT,
            qr: { ...DEFAULT_LAYOUT.qr, x: batch.qr_layout?.x ?? 0.82, y: batch.qr_layout?.y ?? 0.78, w: batch.qr_layout?.size ?? 0.18, dark: batch.qr_layout?.qr_dark ?? DEFAULT_LAYOUT.qr.dark, light: batch.qr_layout?.qr_light ?? DEFAULT_LAYOUT.qr.light },
            code: { ...DEFAULT_LAYOUT.code, x: batch.qr_layout?.code_x ?? 0.87, y: batch.qr_layout?.code_y ?? 0.85, size: batch.qr_layout?.code_size ?? DEFAULT_LAYOUT.code.size, color: batch.qr_layout?.code_color ?? DEFAULT_LAYOUT.code.color, show: batch.qr_layout?.code_show ?? true, bold: batch.qr_layout?.code_bold ?? true },
          };
          const canvas = await renderTicket(art, layout, credential.code);
          const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Falha ao gerar imagem.")), "image/png"));
          const filename = `${safe(batch.group_name)}_${String(credential.seq).padStart(4,"0")}_${credential.code}.png`;
          if (mode === "images") zip.file(filename, png);
          const key = `${batch.width_mm}x${batch.height_mm}`;
          const { a4Grid } = await import("@/lib/print");
          const grid = a4Grid(Number(batch.width_mm), Number(batch.height_mm));
          if (key !== currentSize) { pageSlot = 0; currentSize = key; }
          const perPage = grid.cols * grid.rows;
          if (!pageOpen) pageOpen = true;
          else if (pageSlot === 0) pdf.addPage("a4", "portrait");
          const cw = grid.rot ? Number(batch.height_mm) : Number(batch.width_mm);
          const ch = grid.rot ? Number(batch.width_mm) : Number(batch.height_mm);
          const usedW = grid.cols * cw + (grid.cols - 1) * grid.gap;
          const usedH = grid.rows * ch + (grid.rows - 1) * grid.gap;
          const col = pageSlot % grid.cols, row = Math.floor(pageSlot / grid.cols);
          const x = (210 - usedW) / 2 + col * (cw + grid.gap);
          const y = (297 - usedH) / 2 + row * (ch + grid.gap);
          pdf.addImage(await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(png); }), "PNG", x, y, cw, ch, undefined, "FAST");
          // Subtle but visible cutting guide around every credential on the A4 sheet.
          // The artwork remains untouched; this border is only part of the print PDF.
          pdf.setDrawColor(105, 105, 105);
          pdf.setLineWidth(0.22);
          pdf.setLineDashPattern([1.4, 1.1], 0);
          pdf.rect(x, y, cw, ch);
          pdf.setLineDashPattern([], 0);
          pageSlot = (pageSlot + 1) % perPage;
          done++; setProgress(Math.round(done / total * 100));
          if (done % 15 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      } finally { artCache.forEach((art) => art.close()); }
      if (mode === "pdf") {
        const blob = pdf.output("blob");
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = `${safe(eventName)}_CREDENCIAIS_A4.pdf`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = `${safe(eventName)}_CREDENCIAIS_PNG.zip`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      toast.success(`${total} credenciais preparadas.`);
    } catch (e) { toast.error("Não foi possível exportar: " + (e as Error).message); }
    finally { setLoading(false); setProgress(0); }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-dashed p-5 space-y-3">
        <div className="flex items-center gap-2"><QrCode className="h-5 w-5 text-primary" /><h3 className="font-semibold">Importar credenciais</h3></div>
        <p className="text-sm text-muted-foreground">Carregue as artes em lote. O nome do ficheiro identifica evento, grupo, tamanho e quantidade. Pode corrigir os dados antes de criar os QR Codes.</p>
        <div onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }} className="cursor-pointer rounded-lg border-2 border-dashed p-6 text-center hover:border-primary/60">
          <FileUp className="mx-auto mb-2 h-7 w-7" /><p className="font-medium">Arraste os ficheiros ou clique para selecionar</p><p className="text-xs text-muted-foreground">PDF, PNG, JPG, WEBP e TIFF · máximo 100 por lote</p>
          <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff" className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        </div>
        {drafts.length > 0 && <div className="space-y-3">
          <div className="flex items-center justify-between"><b>{drafts.length} ficheiro(s) lidos</b><Button onClick={() => void saveDrafts()} disabled={saving || loading}>{saving ? "A criar..." : "Criar grupos e QR Codes"}</Button></div>
          {drafts.map((d) => <div key={d.key} className="grid grid-cols-[64px_1fr] gap-3 rounded-lg border p-3">
            <img src={d.preview} alt="" className="h-16 w-16 rounded object-cover" />
            <div className="min-w-0 space-y-2">
              <p className="truncate text-xs text-muted-foreground">{d.file.name}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div><Label>Evento</Label><Input value={d.eventName} onChange={(e) => updateDraft(d.key,{eventName:e.target.value})} /></div>
                <div><Label>Grupo / tipo</Label><Input value={d.groupName} onChange={(e) => updateDraft(d.key,{groupName:e.target.value,credentialType:e.target.value})} /></div>
                <div><Label>Tamanho</Label><select value={d.size} onChange={(e) => { const s=e.target.value as CredentialSize; const [w,h]=sizeMm[s]; updateDraft(d.key,{size:s,widthMm:w,heightMm:h}); }} className="h-10 w-full rounded-md border bg-background px-2"><option>A6</option><option>A5</option><option>A4</option></select></div>
                <div><Label>Quantidade</Label><Input type="number" min={1} max={10000} value={d.quantity} onChange={(e) => updateDraft(d.key,{quantity:Math.max(1,Math.min(10000,Number(e.target.value)||1))})} /></div>
              </div>
            </div>
          </div>)}
        </div>}
      </div>
      <div className="rounded-xl border overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div><h3 className="font-semibold">Grupos de credenciais</h3><p className="text-xs text-muted-foreground">{batches.length} grupo(s) · selecione vários para exportar em conjunto</p></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!batches.length} onClick={() => setSelected(new Set(batches.map((b) => b.id)))}>Selecionar tudo</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
            <Button variant="secondary" disabled={!batches.length || loading} onClick={() => void buildOutput("pdf", batches, qty)}><Printer className="h-4 w-4" /> Imprimir tudo</Button>
            <Button disabled={!selected.size || loading} onClick={() => void buildOutput("pdf")}><Printer className="h-4 w-4" /> PDF A4 ({selected.size})</Button>
            <Button variant="secondary" disabled={!selected.size || loading} onClick={() => void buildOutput("images")}><Download className="h-4 w-4" /> Imagens ZIP</Button>
          </div>
        </div>
        {progress > 0 && <Progress value={progress} />}
        {batches.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Ainda não existem credenciais para este evento.</p> : <div className="divide-y">
          {batches.map((b) => <div key={b.id} className="flex flex-wrap items-center gap-3 p-3">
            <Checkbox checked={selected.has(b.id)} onCheckedChange={(v) => setSelected((s) => { const n=new Set(s); if (v) n.add(b.id); else n.delete(b.id); return n; })} />
            <div className="min-w-[180px] flex-1"><p className="font-medium">{b.group_name} <span className="text-xs text-muted-foreground">· {b.credential_type}</span></p><p className="text-xs text-muted-foreground">{b.event_name} · {b.size_code} · {b.quantity} credenciais</p><p className="text-[11px] text-muted-foreground truncate">{b.source_filename}</p></div>
            {isAdmin && <><Button size="sm" variant="outline" onClick={() => setLayoutBatch(b)}><QrCode className="h-3 w-3" /> Editor visual</Button><Button size="sm" variant="outline" onClick={() => startBatchEdit(b)}><Pencil className="h-3 w-3" /> Editar grupo</Button></>}
            <Input type="number" min={0} max={10000} value={qty[b.id] ?? b.quantity} onChange={(e) => setQty((q) => ({...q,[b.id]:Math.max(0,Math.min(10000,Number(e.target.value)||0))}))} className="w-24" aria-label={`Quantidade de ${b.group_name}`} />
            <Button size="sm" variant="outline" onClick={() => void changeQuantity(b)}><RefreshCw className="h-3 w-3" /> Atualizar</Button>
            <div className="flex flex-wrap items-end gap-2 w-full pl-8">
              <div><Label className="text-[10px]">QR X</Label><Input aria-label="Posição horizontal QR" type="number" min={0.05} max={0.95} step={0.01} defaultValue={b.qr_layout?.x ?? 0.82} className="h-8 w-20" onBlur={(e) => void saveQrLayout(b,{x:Math.max(0.05,Math.min(0.95,Number(e.target.value)||0.82))})} /></div>
              <div><Label className="text-[10px]">QR Y</Label><Input aria-label="Posição vertical QR" type="number" min={0.05} max={0.95} step={0.01} defaultValue={b.qr_layout?.y ?? 0.78} className="h-8 w-20" onBlur={(e) => void saveQrLayout(b,{y:Math.max(0.05,Math.min(0.95,Number(e.target.value)||0.78))})} /></div>
              <div><Label className="text-[10px]">Tamanho QR</Label><Input aria-label="Tamanho QR" type="number" min={0.08} max={0.35} step={0.01} defaultValue={b.qr_layout?.size ?? 0.18} className="h-8 w-24" onBlur={(e) => void saveQrLayout(b,{size:Math.max(0.08,Math.min(0.35,Number(e.target.value)||0.18))})} /></div>
              <div><Label className="text-[10px]">Código X</Label><Input aria-label="Posição horizontal do código" type="number" min={0.05} max={0.95} step={0.01} defaultValue={b.qr_layout?.code_x ?? 0.87} className="h-8 w-24" onBlur={(e) => void saveCodeLayout(b,{code_x:Math.max(0.05,Math.min(0.95,Number(e.target.value)||0.87))})} /></div>
              <div><Label className="text-[10px]">Código Y</Label><Input aria-label="Posição vertical do código" type="number" min={0.05} max={0.95} step={0.01} defaultValue={b.qr_layout?.code_y ?? 0.85} className="h-8 w-24" onBlur={(e) => void saveCodeLayout(b,{code_y:Math.max(0.05,Math.min(0.95,Number(e.target.value)||0.85))})} /></div>
              <span className="pb-2 text-[10px] text-muted-foreground">Posições proporcionais à arte (0–1). As alterações são guardadas ao sair do campo.</span>
            </div>
            
            <Button size="icon" variant="ghost" onClick={() => void deleteBatch(b)} aria-label="Eliminar grupo"><Trash2 className="h-4 w-4" /></Button>
          </div>)}
        </div>}
      </div>
      <CredentialLayoutEditor batch={layoutBatch} compatibleBatches={batches} onClose={() => setLayoutBatch(null)} onSaved={() => { void refresh(); }} />
      <Dialog open={Boolean(editingBatch)} onOpenChange={(open) => {
        if (!open && !savingBatchEdit) { setEditingBatch(null); setBatchEdit(null); }
      }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar grupo de credenciais</DialogTitle></DialogHeader>
          {batchEdit && <div className="space-y-4">
            <div><Label>Evento</Label><Input value={batchEdit.event_name} onChange={(e) => setBatchEdit({ ...batchEdit, event_name: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Grupo</Label><Input value={batchEdit.group_name} onChange={(e) => setBatchEdit({ ...batchEdit, group_name: e.target.value })} /></div>
              <div><Label>Tipo de credencial</Label><Input value={batchEdit.credential_type} onChange={(e) => setBatchEdit({ ...batchEdit, credential_type: e.target.value })} /></div>
            </div>
            <div><Label>Formato</Label><select value={batchEdit.size_code} onChange={(e) => {
              const size = e.target.value as CredentialSize; const [width, height] = sizeMm[size];
              setBatchEdit({ ...batchEdit, size_code: size, width_mm: String(width), height_mm: String(height) });
            }} className="h-10 w-full rounded-md border border-input bg-background px-3">
              <option value="A6">A6</option><option value="A5">A5</option><option value="A4">A4</option><option value="CUSTOM">Personalizado</option>
            </select></div>
            {batchEdit.size_code === "CUSTOM" && <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Largura (mm)</Label><Input type="number" min="1" step="0.1" value={batchEdit.width_mm} onChange={(e) => setBatchEdit({ ...batchEdit, width_mm: e.target.value })} /></div>
              <div><Label>Altura (mm)</Label><Input type="number" min="1" step="0.1" value={batchEdit.height_mm} onChange={(e) => setBatchEdit({ ...batchEdit, height_mm: e.target.value })} /></div>
            </div>}
            <p className="text-xs text-muted-foreground">Os códigos, QR Codes e a arte guardada não serão alterados; os novos nomes/formato passam a aparecer nas próximas exportações e relatórios.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setEditingBatch(null); setBatchEdit(null); }} disabled={savingBatchEdit}>Cancelar</Button>
              <Button onClick={() => void saveBatchEdit()} disabled={savingBatchEdit}>{savingBatchEdit ? "A guardar…" : "Guardar alterações"}</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
