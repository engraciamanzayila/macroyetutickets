import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Save, ArrowLeft } from "lucide-react";

type Layout = {
  qr: { x: number; y: number; w: number; dark: string; light: string };
  code: { x: number; y: number; size: number; color: string; show: boolean; bold: boolean };
};
type Batch = {
  id: string; art_path: string; art_width: number; art_height: number; group_name: string;
  width_mm: number; height_mm: number; size_code: string;
  qr_layout: { x?: number; y?: number; size?: number; code_x?: number; code_y?: number; qr_dark?: string; qr_light?: string; code_size?: number; code_color?: string; code_show?: boolean; code_bold?: boolean } | null;
};
type Props = { batch: Batch | null; compatibleBatches: Batch[]; onClose: () => void; onSaved: () => void };
const SAMPLE = "CRD-AB12-CD34";
const defaults: Layout = {
  qr: { x: .78, y: .76, w: .18, dark: "#000000", light: "#ffffff" },
  code: { x: .78, y: .88, size: .035, color: "#000000", show: true, bold: true },
};
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

export function CredentialLayoutEditor({ batch, compatibleBatches, onClose, onSaved }: Props) {
  const [artUrl, setArtUrl] = useState("");
  const [qrReady, setQrReady] = useState(false);
  const [qrError, setQrError] = useState("");
  const [artRatio, setArtRatio] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 600, height: 600 });
  const [layout, setLayout] = useState<Layout>(defaults);
  const [saving, setSaving] = useState(false);
  const [copyToIds, setCopyToIds] = useState<string[]>([]);
  const [artError, setArtError] = useState("");
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const qrCanvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ kind: "qr" | "code" | "resize"; x: number; y: number; start: Layout } | null>(null);

  useEffect(() => {
    if (!batch) return;
    let alive = true;
    let objectUrl = "";
    const saved = batch.qr_layout ?? {};
    setLayout({
      qr: {
        ...defaults.qr,
        x: clamp(saved.x ?? defaults.qr.x),
        y: clamp(saved.y ?? defaults.qr.y),
        w: Math.min(.9, Math.max(.02, saved.size ?? defaults.qr.w)),
        dark: saved.qr_dark ?? defaults.qr.dark,
        light: saved.qr_light ?? defaults.qr.light,
      },
      code: {
        ...defaults.code,
        x: clamp(saved.code_x ?? defaults.code.x),
        y: clamp(saved.code_y ?? defaults.code.y),
        size: Math.min(.2, Math.max(.01, saved.code_size ?? defaults.code.size)),
        color: saved.code_color ?? defaults.code.color,
        show: saved.code_show ?? defaults.code.show,
        bold: saved.code_bold ?? defaults.code.bold,
      },
    });
    setArtUrl(""); setQrReady(false); setQrError(""); setArtError(""); setCopyToIds([]);
    void (async () => {
      const { data, error } = await supabase.storage.from("arts").download(batch.art_path);
      if (error || !data) throw error ?? new Error("Ficheiro da arte vazio.");
      const bitmap = await createImageBitmap(data);
      const ratio = bitmap.height / bitmap.width;
      bitmap.close();
      if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("Dimensões inválidas na arte.");
      objectUrl = URL.createObjectURL(data);
      if (alive) { setArtRatio(ratio); setArtUrl(objectUrl); }
    })().catch((error) => {
      if (alive) { setArtError((error as Error).message); toast.error("Não foi possível carregar a arte: " + (error as Error).message); }
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [batch]);

  useEffect(() => {
    const canvas = qrCanvas.current;
    if (!canvas) return;
    let alive = true;
    setQrReady(false);
    setQrError("");
    try {
      QRCode.toCanvas(canvas, SAMPLE, {
        margin: 1, width: 512, errorCorrectionLevel: "M",
        color: { dark: layout.qr.dark, light: layout.qr.light },
      }, (error) => {
        if (!alive) return;
        if (error) { setQrReady(false); setQrError(error.message || "Não foi possível gerar o QR Code."); return; }
        setQrReady(true);
      });
    } catch (error) {
      setQrReady(false);
      setQrError((error as Error).message || "Não foi possível gerar o QR Code.");
    }
    return () => { alive = false; };
  }, [layout.qr.dark, layout.qr.light, batch?.id, artUrl]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const availableWidth = el.clientWidth;
      const maxHeight = Math.max(220, window.innerHeight * .62);
      const width = Math.max(1, Math.min(availableWidth, maxHeight / artRatio));
      setStageSize({ width, height: width * artRatio });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [artRatio, batch]);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-drag]");
    const kind = target?.dataset.drag as "qr" | "code" | "resize" | undefined;
    if (!kind || !stage.current) return;
    e.preventDefault();
    e.stopPropagation();
    stage.current.setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, start: layout };
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!d || !rect || rect.width <= 0 || rect.height <= 0) return;
    const dx = (e.clientX - d.x) / rect.width;
    const dy = (e.clientY - d.y) / rect.height;
    if (d.kind === "qr") {
      setLayout((v) => ({ ...v, qr: { ...v.qr, x: clamp(d.start.qr.x + dx), y: clamp(d.start.qr.y + dy) } }));
    } else if (d.kind === "code") {
      setLayout((v) => ({ ...v, code: { ...v.code, x: clamp(d.start.code.x + dx), y: clamp(d.start.code.y + dy) } }));
    } else {
      setLayout((v) => ({ ...v, qr: { ...v.qr, w: Math.min(.9, Math.max(.02, d.start.qr.w + dx * 2)) } }));
    }
  };

  const stopDrag = () => { drag.current = null; };

  const save = async () => {
    if (!batch || saving || !artUrl || !qrReady) return;
    setSaving(true);
    const next = {
      ...(batch.qr_layout ?? {}),
      x: layout.qr.x, y: layout.qr.y, size: layout.qr.w,
      code_x: layout.code.x, code_y: layout.code.y,
      qr_dark: layout.qr.dark, qr_light: layout.qr.light,
      code_size: layout.code.size, code_color: layout.code.color,
      code_show: layout.code.show, code_bold: layout.code.bold,
    };
    const targetIds = [batch.id, ...copyToIds];
    const { error } = await supabase.from("credential_batches").update({ qr_layout: next }).in("id", targetIds);
    setSaving(false);
    if (error) return toast.error("Não foi possível guardar o modelo: " + error.message);
    toast.success(copyToIds.length
      ? `Modelo guardado e copiado para mais ${copyToIds.length} grupo(s) compatível(is).`
      : "Modelo visual guardado. Será usado na impressão e exportação.");
    onSaved(); onClose();
  };

  return (
    <Dialog open={Boolean(batch)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editor visual da credencial — {batch?.group_name}</DialogTitle>
          <DialogDescription>Arraste o QR e a referência. Redimensione o QR pelo canto e ajuste as propriedades.</DialogDescription>
        </DialogHeader>
        {batch && (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
            <div className="rounded-2xl border bg-muted/30 p-3 md:p-5 overflow-hidden">
              <div ref={frame} className="w-full flex justify-center items-center overflow-auto">
                <div
                  ref={stage}
                  className="relative shrink-0 select-none shadow-xl bg-white"
                  style={{ width: stageSize.width, height: stageSize.height, aspectRatio: `1 / ${artRatio}`, touchAction: "none" }}
                  onPointerDown={startDrag}
                  onPointerMove={moveDrag}
                  onPointerUp={stopDrag}
                  onPointerCancel={stopDrag}
                >
                  {artUrl && <img
                    src={artUrl} alt="Arte original da credencial" draggable={false}
                    className="absolute inset-0 z-0 block h-full w-full pointer-events-none"
                    style={{ objectFit: "fill" }}
                  />}
                  {artUrl && <div
                    data-drag="qr"
                    className="absolute z-20 box-border cursor-move overflow-hidden border-2 border-dashed border-primary bg-white p-1 shadow-md"
                    style={{
                      width: `${layout.qr.w * 100}%`, aspectRatio: "1 / 1",
                      left: `${layout.qr.x * 100}%`, top: `${layout.qr.y * 100}%`,
                      transform: "translate(-50%, -50%)", touchAction: "none",
                    }}
                  >
                    <canvas ref={qrCanvas} aria-label="QR Code de exemplo" className="pointer-events-none block" style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%" }} />
                    <span data-drag="resize" className="absolute -right-2 -bottom-2 h-5 w-5 rounded-sm border-2 border-white bg-primary shadow cursor-nwse-resize" />
                  </div>}
                  {layout.code.show && <div
                    data-drag="code"
                    className="absolute z-30 cursor-move whitespace-nowrap border border-dashed border-amber-500 bg-white/90 px-2 py-1 shadow-sm"
                    style={{
                      left: `${layout.code.x * 100}%`, top: `${layout.code.y * 100}%`,
                      transform: "translate(-50%, -50%)",
                      fontSize: Math.max(9, Math.min(48, layout.code.size * stageSize.height)),
                      color: layout.code.color, fontWeight: layout.code.bold ? 700 : 500,
                      lineHeight: 1.15, touchAction: "none",
                    }}
                  >{SAMPLE}</div>}
                </div>
              </div>
              {!artUrl && <p className="py-8 text-center text-sm text-muted-foreground">{artError ? "Erro ao carregar a arte: " + artError : "A carregar arte da credencial…"}</p>}
              {!qrReady && artUrl && <p className="py-2 text-center text-xs text-destructive">{qrError ? "Erro no QR Code: " + qrError : "A preparar o QR Code…"}</p>}
              <p className="mt-3 text-center text-xs text-muted-foreground">Arraste o QR ou a referência. Puxe o quadrado no canto inferior direito do QR para redimensionar.</p>
            </div>
            <aside className="rounded-xl border bg-card p-4 space-y-5 h-fit">
              <section className="space-y-3">
                <h3 className="font-bold">QR Code</h3>
                <Label>Tamanho · {Math.round(layout.qr.w * 100)}%</Label>
                <Slider min={2} max={60} step={.5} value={[layout.qr.w * 100]} onValueChange={([v]) => setLayout((s) => ({ ...s, qr: { ...s.qr, w: v / 100 } }))} />
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm space-y-1"><span className="text-muted-foreground">Cor</span><input type="color" value={layout.qr.dark} onChange={(e) => setLayout((s) => ({ ...s, qr: { ...s.qr, dark: e.target.value } }))} className="h-9 w-full rounded-md bg-transparent" /></label>
                  <label className="text-sm space-y-1"><span className="text-muted-foreground">Fundo</span><input type="color" value={layout.qr.light} onChange={(e) => setLayout((s) => ({ ...s, qr: { ...s.qr, light: e.target.value } }))} className="h-9 w-full rounded-md bg-transparent" /></label>
                </div>
              </section>
              <section className="space-y-3">
                <div className="flex items-center justify-between"><h3 className="font-bold">Código de referência</h3><Switch checked={layout.code.show} onCheckedChange={(v) => setLayout((s) => ({ ...s, code: { ...s.code, show: v } }))} /></div>
                {layout.code.show && <>
                  <Label>Tamanho do texto · {Math.round(layout.code.size * 100)}%</Label>
                  <Slider min={1} max={20} step={.25} value={[layout.code.size * 100]} onValueChange={([v]) => setLayout((s) => ({ ...s, code: { ...s.code, size: v / 100 } }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm space-y-1"><span className="text-muted-foreground">Cor</span><input type="color" value={layout.code.color} onChange={(e) => setLayout((s) => ({ ...s, code: { ...s.code, color: e.target.value } }))} className="h-9 w-full rounded-md bg-transparent" /></label>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={layout.code.bold} onCheckedChange={(v) => setLayout((s) => ({ ...s, code: { ...s.code, bold: v } }))} /> Negrito</label>
                  </div>
                </>}
              </section>
              {compatibleBatches.filter((item) => item.id !== batch.id && item.width_mm === batch.width_mm && item.height_mm === batch.height_mm).length > 0 && (
                <section className="space-y-2 rounded-lg border p-3">
                  <div>
                    <h3 className="font-bold text-sm">Reutilizar este modelo</h3>
                    <p className="text-xs text-muted-foreground">Opcionalmente, copia a posição, tamanho e aparência do QR e da referência para outros grupos com as mesmas dimensões ({batch.width_mm} × {batch.height_mm} mm). Cada grupo mantém a sua própria arte e os seus códigos.</p>
                  </div>
                  <div className="max-h-36 space-y-2 overflow-y-auto">
                    {compatibleBatches.filter((item) => item.id !== batch.id && item.width_mm === batch.width_mm && item.height_mm === batch.height_mm).map((item) => (
                      <label key={item.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={copyToIds.includes(item.id)}
                          onChange={(e) => setCopyToIds((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate">{item.group_name}</span>
                        <span className="text-xs text-muted-foreground">{item.size_code}</span>
                      </label>
                    ))}
                  </div>
                  {copyToIds.length > 0 && <p className="text-xs font-medium text-primary">{copyToIds.length} grupo(s) selecionado(s) para receber o modelo.</p>}
                </section>
              )}
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={onClose}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button onClick={() => void save()} disabled={saving || !artUrl || !qrReady}><Save className="h-4 w-4" /> {saving ? "A guardar…" : "Guardar modelo"}</Button>
              </div>
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
