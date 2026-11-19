import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { PointerEvent as ReactPointerEvent } from "react";

type Batch = {
  id: string;
  art_path: string;
  art_width: number;
  art_height: number;
  group_name: string;
  qr_layout: { x?: number; y?: number; size?: number; code_x?: number; code_y?: number } | null;
};

type Props = { batch: Batch | null; onClose: () => void; onSaved: () => void };

export function CredentialLayoutEditor({ batch, onClose, onSaved }: Props) {
  const [artUrl, setArtUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [qr, setQr] = useState({ x: 0.82, y: 0.78, size: 0.18 });
  const [code, setCode] = useState({ x: 0.87, y: 0.85 });
  const [dragging, setDragging] = useState<"qr" | "code" | null>(null);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!batch) return;
    let active = true;
    let objectUrl = "";
    setQr({ x: batch.qr_layout?.x ?? 0.82, y: batch.qr_layout?.y ?? 0.78, size: batch.qr_layout?.size ?? 0.18 });
    setCode({ x: batch.qr_layout?.code_x ?? 0.87, y: batch.qr_layout?.code_y ?? 0.85 });
    setArtUrl("");
    void (async () => {
      const { data, error } = await supabase.storage.from("arts").download(batch.art_path);
      if (error || !data) { toast.error("Não foi possível carregar a arte da credencial."); return; }
      objectUrl = URL.createObjectURL(data);
      if (active) setArtUrl(objectUrl);
      const sample = await QRCode.toDataURL("MYT-CREDENCIAL-PREVIEW", { margin: 1, width: 300 });
      if (active) setQrUrl(sample);
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [batch]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !stage.current) return;
    const rect = stage.current.getBoundingClientRect();
    const x = Math.max(0.02, Math.min(0.98, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0.02, Math.min(0.98, (event.clientY - rect.top) / rect.height));
    if (dragging === "qr") setQr((v) => ({ ...v, x, y }));
    else setCode({ x, y });
  };

  const save = async () => {
    if (!batch || saving) return;
    setSaving(true);
    const next = { ...(batch.qr_layout ?? {}), x: qr.x, y: qr.y, size: qr.size, code_x: code.x, code_y: code.y };
    const { error } = await supabase.from("credential_batches").update({ qr_layout: next }).eq("id", batch.id);
    setSaving(false);
    if (error) return toast.error("Não foi possível guardar o posicionamento: " + error.message);
    toast.success("Posicionamento guardado. Será aplicado às próximas exportações.");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={Boolean(batch)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editor visual da credencial</DialogTitle>
          <DialogDescription>Arraste o QR Code e a referência diretamente sobre a arte. Ajuste o tamanho do QR abaixo.</DialogDescription>
        </DialogHeader>
        {batch && <div className="space-y-4">
          <div
            ref={stage}
            onPointerMove={move}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
            onPointerLeave={() => setDragging(null)}
            className="relative mx-auto w-full max-w-[560px] overflow-hidden rounded-lg border bg-muted touch-none select-none"
            style={{ aspectRatio: `${batch.art_width} / ${batch.art_height}` }}
          >
            {artUrl ? <img src={artUrl} alt="Arte da credencial" draggable={false} className="absolute inset-0 h-full w-full object-fill pointer-events-none" /> : <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">A carregar arte…</div>}
            {qrUrl && <div
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragging("qr"); e.currentTarget.setPointerCapture(e.pointerId); }}
              className="absolute z-10 cursor-move border-2 border-blue-500 bg-white p-1 shadow-lg"
              style={{ left: `${qr.x * 100}%`, top: `${qr.y * 100}%`, width: `${qr.size * 100}%`, aspectRatio: "1", transform: "translate(-50%, -50%)" }}
              title="Arrastar QR Code"
            ><img src={qrUrl} alt="Pré-visualização QR" draggable={false} className="h-full w-full pointer-events-none" /></div>}
            <div
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragging("code"); e.currentTarget.setPointerCapture(e.pointerId); }}
              className="absolute z-20 cursor-move whitespace-nowrap rounded border-2 border-amber-500 bg-white/90 px-2 py-1 font-mono text-[clamp(8px,2vw,14px)] font-bold text-black shadow"
              style={{ left: `${code.x * 100}%`, top: `${code.y * 100}%`, transform: "translate(-50%, -50%)" }}
              title="Arrastar referência"
            >CRD-XXXX-XXXX</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-w-52 flex-1 items-center gap-3 text-sm">Tamanho do QR
              <input type="range" min="0.08" max="0.35" step="0.01" value={qr.size} onChange={(e) => setQr((v) => ({ ...v, size: Number(e.target.value) }))} className="w-full" />
              <span className="w-12 text-right tabular-nums">{Math.round(qr.size * 100)}%</span>
            </label>
            <span className="text-xs text-muted-foreground">Azul: QR Code · Dourado: referência</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void save()} disabled={saving || !artUrl}>{saving ? "A guardar…" : "Guardar posições"}</Button>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
