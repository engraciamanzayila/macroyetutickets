import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { artUrl, type Group } from "@/lib/generate";
import { DEFAULT_LAYOUT, type Layout } from "@/lib/render";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_app/editor/$groupId")({
  head: () => ({
    meta: [
      { title: "Editor de QR — MY Tickets" },
      { name: "description", content: "Posicione o QR code e o código de referência na arte do ingresso." },
      { property: "og:title", content: "Editor de QR — MY Tickets" },
      { property: "og:description", content: "Posicione o QR code na arte do ingresso." },
    ],
  }),
  component: Editor,
});

const SAMPLE = "VIP-AB12-CD34";

function Editor() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: group } = useQuery({
    queryKey: ["group", groupId],
    queryFn: async () => (await supabase.from("ticket_groups").select("*").eq("id", groupId).single()).data as unknown as Group | null,
  });
  const [url, setUrl] = useState("");
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [qrImg, setQrImg] = useState("");
  const [boxW, setBoxW] = useState(800);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "qr" | "code" | "resize"; sx: number; sy: number; start: Layout } | null>(null);

  useEffect(() => {
    if (!group) return;
    if (group.art_path) artUrl(group.art_path).then(setUrl);
    if (group.layout) setLayout({ ...DEFAULT_LAYOUT, ...group.layout, qr: { ...DEFAULT_LAYOUT.qr, ...group.layout.qr }, code: { ...DEFAULT_LAYOUT.code, ...group.layout.code } });
  }, [group]);

  useEffect(() => {
    QRCode.toDataURL(SAMPLE, { margin: 1, width: 400, color: { dark: layout.qr.dark, light: layout.qr.light } }).then(setQrImg);
  }, [layout.qr.dark, layout.qr.light]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [url]);

  const ratio = group?.art_width && group.art_height ? group.art_height / group.art_width : 0.3;
  const boxH = boxW * ratio;

  const onDown = (kind: "qr" | "code" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, start: layout };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / boxW;
    const dy = (e.clientY - d.sy) / boxH;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    if (d.kind === "qr") setLayout({ ...layout, qr: { ...layout.qr, x: clamp(d.start.qr.x + dx), y: clamp(d.start.qr.y + dy) } });
    if (d.kind === "code") setLayout({ ...layout, code: { ...layout.code, x: clamp(d.start.code.x + dx), y: clamp(d.start.code.y + dy) } });
    if (d.kind === "resize") setLayout({ ...layout, qr: { ...layout.qr, w: Math.min(0.9, Math.max(0.02, d.start.qr.w + dx * 2)) } });
  };
  const onUp = () => { drag.current = null; };

  const save = async (back = false) => {
    const { error } = await supabase.from("ticket_groups").update({ layout: layout as never }).eq("id", groupId);
    if (error) return toast.error(error.message);
    toast.success("Posição guardada");
    qc.invalidateQueries({ queryKey: ["groups"] });
    qc.invalidateQueries({ queryKey: ["group", groupId] });
    if (back && group) navigate({ to: "/eventos/$eventId", params: { eventId: group.event_id } });
  };

  const qrPx = layout.qr.w * boxW;
  const physW = group?.width_cm ? Number(group.width_cm) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {group && <Link to="/eventos/$eventId" params={{ eventId: group.event_id }} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Voltar ao evento</Link>}
          <h1 className="text-2xl font-bold mt-1">{group?.name}</h1>
          <p className="text-sm text-muted-foreground">Arraste o QR e o código. Puxe o canto amarelo para redimensionar.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => save(false)}><Save className="h-4 w-4" /> Guardar</Button>
          <Button onClick={() => save(true)}>Guardar e voltar</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-6">
        <div className="rounded-2xl border checker p-4 md:p-8 overflow-hidden">
          <div ref={stage} className="relative w-full select-none touch-none shadow-2xl" style={{ height: boxH || undefined }} onPointerMove={onMove} onPointerUp={onUp}>
            {url && <img src={url} alt="Arte" className="absolute inset-0 h-full w-full" draggable={false} />}
            <div
              onPointerDown={onDown("qr")}
              className="absolute cursor-move outline-2 outline-dashed outline-primary"
              style={{ width: qrPx, height: qrPx, left: layout.qr.x * boxW - qrPx / 2, top: layout.qr.y * boxH - qrPx / 2 }}
            >
              {qrImg && <img src={qrImg} alt="QR" className="h-full w-full pointer-events-none" draggable={false} />}
              <span onPointerDown={onDown("resize")} className="absolute -right-2 -bottom-2 h-4 w-4 rounded-sm bg-primary cursor-nwse-resize" />
            </div>
            {layout.code.show && (
              <div
                onPointerDown={onDown("code")}
                className="absolute cursor-move whitespace-nowrap outline-1 outline-dashed outline-primary/70 px-0.5 font-mono leading-none"
                style={{
                  left: layout.code.x * boxW,
                  top: layout.code.y * boxH,
                  transform: "translate(-50%, -50%)",
                  fontSize: Math.max(6, layout.code.size * boxH),
                  color: layout.code.color,
                  fontWeight: layout.code.bold ? 700 : 500,
                }}
              >
                {SAMPLE}
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-2xl border bg-card p-5 space-y-6 h-fit">
          <section className="space-y-3">
            <h3 className="font-bold">QR code</h3>
            <div className="space-y-2">
              <Label>Tamanho {physW ? `· ${(layout.qr.w * physW).toFixed(1)} cm` : ""}</Label>
              <Slider min={2} max={60} step={0.5} value={[layout.qr.w * 100]} onValueChange={([v]) => setLayout({ ...layout, qr: { ...layout.qr, w: v / 100 } })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm space-y-1"><span className="text-muted-foreground">Cor</span><input type="color" value={layout.qr.dark} onChange={(e) => setLayout({ ...layout, qr: { ...layout.qr, dark: e.target.value } })} className="h-9 w-full rounded-md bg-transparent" /></label>
              <label className="text-sm space-y-1"><span className="text-muted-foreground">Fundo</span><input type="color" value={layout.qr.light} onChange={(e) => setLayout({ ...layout, qr: { ...layout.qr, light: e.target.value } })} className="h-9 w-full rounded-md bg-transparent" /></label>
            </div>
            <p className="text-xs text-muted-foreground">Dica: mantenha bom contraste (QR escuro em fundo claro) para leitura rápida.</p>
          </section>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Código de referência</h3>
              <Switch checked={layout.code.show} onCheckedChange={(v) => setLayout({ ...layout, code: { ...layout.code, show: v } })} />
            </div>
            {layout.code.show && (
              <>
                <div className="space-y-2">
                  <Label>Tamanho do texto</Label>
                  <Slider min={1} max={20} step={0.25} value={[layout.code.size * 100]} onValueChange={([v]) => setLayout({ ...layout, code: { ...layout.code, size: v / 100 } })} />
                </div>
                <div className="grid grid-cols-2 gap-3 items-end">
                  <label className="text-sm space-y-1"><span className="text-muted-foreground">Cor</span><input type="color" value={layout.code.color} onChange={(e) => setLayout({ ...layout, code: { ...layout.code, color: e.target.value } })} className="h-9 w-full rounded-md bg-transparent" /></label>
                  <label className="flex items-center gap-2 text-sm h-9"><Switch checked={layout.code.bold} onCheckedChange={(v) => setLayout({ ...layout, code: { ...layout.code, bold: v } })} /> Negrito</label>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
