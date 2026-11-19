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
  qr_layout: { x?: number; y?: number; size?: number; code_x?: number; code_y?: number; qr_dark?: string; qr_light?: string; code_size?: number; code_color?: string; code_show?: boolean; code_bold?: boolean } | null;
};
type Props = { batch: Batch | null; onClose: () => void; onSaved: () => void };
const SAMPLE = "CRD-AB12-CD34";
const defaults: Layout = {
  qr: { x: .82, y: .78, w: .18, dark: "#000000", light: "#ffffff" },
  code: { x: .87, y: .85, size: .035, color: "#000000", show: true, bold: true },
};

export function CredentialLayoutEditor({ batch, onClose, onSaved }: Props) {
  const [artUrl, setArtUrl] = useState("");
  const [qrImg, setQrImg] = useState("");
  const [layout, setLayout] = useState<Layout>(defaults);
  const [saving, setSaving] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 800, height: 800 });
  const [artRatio, setArtRatio] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "qr" | "code" | "resize"; sx: number; sy: number; start: Layout } | null>(null);

  useEffect(() => {
    if (!batch) return;
    let alive = true;
    let objectUrl = "";
    const saved = batch.qr_layout ?? {};
    setLayout({
      qr: {
        ...defaults.qr,
        x: saved.x ?? defaults.qr.x,
        y: saved.y ?? defaults.qr.y,
        w: saved.size ?? defaults.qr.w,
        dark: saved.qr_dark ?? defaults.qr.dark,
        light: saved.qr_light ?? defaults.qr.light,
      },
      code: {
        ...defaults.code,
        x: saved.code_x ?? defaults.code.x,
        y: saved.code_y ?? defaults.code.y,
        size: saved.code_size ?? defaults.code.size,
        color: saved.code_color ?? defaults.code.color,
        show: saved.code_show ?? defaults.code.show,
        bold: saved.code_bold ?? defaults.code.bold,
      },
    });
    setArtUrl("");
    setQrImg("");
    void (async () => {
      const { data, error } = await supabase.storage.from("arts").download(batch.art_path);
      if (error || !data) {
        if (alive) toast.error("Não foi possível carregar a arte: " + (error?.message ?? ""));
        return;
      }
      const bitmap = await createImageBitmap(data);
      const ratio = bitmap.height / bitmap.width;
      bitmap.close();
      objectUrl = URL.createObjectURL(data);
      if (alive) {
        setArtRatio(ratio);
        setArtUrl(objectUrl);
      }
    })().catch((error) => {
      if (alive) toast.error("Erro ao preparar a arte: " + (error as Error).message);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [batch]);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(SAMPLE, {
      margin: 1,
      width: 500,
      errorCorrectionLevel: "H",
      color: { dark: layout.qr.dark, light: layout.qr.light },
    }).then((url) => { if (alive) setQrImg(url); })
      .catch(() => toast.error("Não foi possível gerar a pré-visualização do QR Code."));
    return () => { alive = false; };
  }, [layout.qr.dark, layout.qr.light]);

  // Measure the available frame and fit the artwork without ever stretching it.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const availableWidth = el.clientWidth;
      const maxHeight = Math.max(220, window.innerHeight * 0.62);
      const width = Math.max(1, Math.min(availableWidth, maxHeight / artRatio));
      setStageSize({ width, height: width * artRatio });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [artRatio, batch]);

  const boxW = stageSize.width;
  const boxH = stageSize.height;
  const onDown = (kind: "qr" | "code" | "resize") => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, start: layout };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !boxW || !boxH) return;
    const dx = (e.clientX - d.sx) / boxW;
    const dy = (e.clientY - d.sy) / boxH;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    if (d.kind === "qr") {
      setLayout((v) => ({ ...v, qr: { ...v.qr, x: clamp(d.start.qr.x + dx), y: clamp(d.start.qr.y + dy) } }));
    } else if (d.kind === "code") {
      setLayout((v) => ({ ...v, code: { ...v.code, x: clamp(d.start.code.x + dx), y: clamp(d.start.code.y + dy) } }));
    } else {
      setLayout((v) => ({ ...v, qr: { ...v.qr, w: Math.min(.9, Math.max(.02, d.start.qr.w + dx * 2)) } }));
    }
  };

  const save = async () => {
    if (!batch || saving) return;
    setSaving(true);
    const next = {
      ...(batch.qr_layout ?? {}),
      x: layout.qr.x,
      y: layout.qr.y,
      size: layout.qr.w,
      code_x: layout.code.x,
      code_y: layout.code.y,
      qr_dark: layout.qr.dark,
      qr_light: layout.qr.light,
      code_size: layout.code.size,
      code_color: layout.code.color,
      code_show: layout.code.show,
      code_bold: layout.code.bold,
    };
    const { error } = await supabase.from("credential_batches").update({ qr_layout: next }).eq("id", batch.id);
    setSaving(false);
    if (error) return toast.error("Não foi possível guardar: " + error.message);
    toast.success("Modelo visual guardado. Será usado na impressão e exportação.");
    onSaved();
    onClose();
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
                  className="relative shrink-0 select-none touch-none shadow-xl bg-white"
                  style={{ width: stageSize.width, height: stageSize.height, maxWidth: "100%" }}
                  onPointerMove={onMove}
                  onPointerUp={() => { drag.current = null; }}
                  onPointerCancel={() => { drag.current = null; }}
                >
                  {artUrl && (
                    <img
                      src={artUrl}
                      alt="Arte original da credencial"
                      draggable={false}
                      className="absolute inset-0 block pointer-events-none"
                      style={{ width: "100%", height: "100%", objectFit: "fill" }}
                    />
                  )}
                  {qrImg && (
                    <div
                      onPointerDown={onDown("qr")}
                      className="absolute z-20 cursor-move border-2 border-dashed border-primary bg-white p-1 shadow-md"
                      style={{
                        width: layout.qr.w * boxW,
                        height: layout.qr.w * boxW,
                        left: layout.qr.x * boxW - (layout.qr.w * boxW) / 2,
                        top: layout.qr.y * boxH - (layout.qr.w * boxW) / 2,
                        touchAction: "none",
                      }}
                    >
                      <img src={qrImg} alt="QR Code de exemplo" draggable={false} className="block h-full w-full pointer-events-none" />
                      <span
                        onPointerDown={onDown("resize")}
                        className="absolute -right-2 -bottom-2 h-5 w-5 rounded-sm border-2 border-white bg-primary shadow cursor-nwse-resize"
                      />
                    </div>
                  )}
                  {layout.code.show && (
                    <div
                      onPointerDown={onDown("code")}
                      className="absolute z-30 cursor-move whitespace-nowrap border border-dashed border-amber-500 bg-white/90 px-2 py-1 shadow-sm"
                      style={{
                        left: layout.code.x * boxW,
                        top: layout.code.y * boxH,
                        transform: "translate(-50%,-50%)",
                        fontSize: Math.max(9, layout.code.size * boxH),
                        color: layout.code.color,
                        fontWeight: layout.code.bold ? 700 : 500,
                        lineHeight: 1.15,
                        touchAction: "none",
                      }}
                    >
                      {SAMPLE}
                    </div>
                  )}
                </div>
              </div>
              {!artUrl && <p className="py-8 text-center text-sm text-muted-foreground">A carregar arte da credencial…</p>}
              <p className="mt-3 text-center text-xs text-muted-foreground">Arraste o QR ou a referência. Puxe o quadrado no canto do QR para redimensionar.</p>
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
                {layout.code.show && (
                  <>
                    <Label>Tamanho do texto · {Math.round(layout.code.size * 100)}%</Label>
                    <Slider min={1} max={20} step={.25} value={[layout.code.size * 100]} onValueChange={([v]) => setLayout((s) => ({ ...s, code: { ...s.code, size: v / 100 } }))} />
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-sm space-y-1"><span className="text-muted-foreground">Cor</span><input type="color" value={layout.code.color} onChange={(e) => setLayout((s) => ({ ...s, code: { ...s.code, color: e.target.value } }))} className="h-9 w-full rounded-md bg-transparent" /></label>
                      <label className="flex items-center gap-2 text-sm"><Switch checked={layout.code.bold} onCheckedChange={(v) => setLayout((s) => ({ ...s, code: { ...s.code, bold: v } }))} /> Negrito</label>
                    </div>
                  </>
                )}
              </section>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={onClose}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button onClick={() => void save()} disabled={saving || !artUrl || !qrImg}><Save className="h-4 w-4" /> {saving ? "A guardar…" : "Guardar modelo"}</Button>
              </div>
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
