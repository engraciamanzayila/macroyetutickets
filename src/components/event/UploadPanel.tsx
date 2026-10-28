import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { processArt, ACCEPTED, type ProcessedArt } from "@/lib/art";
import { parseFilename, TICKET_TYPES } from "@/lib/filename";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

type Item = {
  key: string;
  file: File;
  art?: ProcessedArt;
  error?: string;
  name: string;
  recipient: string;
  ticketType: string;
  quantity: number;
  price: string;
  widthCm: string;
  heightCm: string;
};

export function UploadPanel({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);

  const addFiles = async (list: FileList | File[]) => {
    let files = Array.from(list);
    if (files.length > 100) {
      toast.warning("Máximo de 100 ficheiros por carregamento. Usámos os primeiros 100.");
      files = files.slice(0, 100);
    }
    const fresh: Item[] = files.map((file) => {
      const p = parseFilename(file.name);
      return {
        key: crypto.randomUUID(),
        file,
        name: p.name,
        recipient: p.recipient,
        ticketType: p.ticketType,
        quantity: p.quantity,
        price: p.price === null ? "" : String(p.price),
        widthCm: p.widthCm ? String(p.widthCm) : "",
        heightCm: p.heightCm ? String(p.heightCm) : "",
      };
    });
    setItems((prev) => [...prev, ...fresh]);
    setProcessing(true);
    for (const it of fresh) {
      try {
        const art = await processArt(it.file);
        setItems((prev) =>
          prev.map((x) =>
            x.key === it.key
              ? { ...x, art, widthCm: x.widthCm || (art.widthCm ? String(art.widthCm) : ""), heightCm: x.heightCm || (art.heightCm ? String(art.heightCm) : "") }
              : x,
          ),
        );
      } catch (e) {
        console.error(e);
        setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, error: "Formato não suportado" } : x)));
      }
    }
    setProcessing(false);
  };

  const update = (key: string, patch: Partial<Item>) => setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const save = async () => {
    const ready = items.filter((i) => i.art);
    setSaving(0);
    let n = 0;
    for (const it of ready) {
      const path = `${eventId}/${crypto.randomUUID()}.png`;
      const up = await supabase.storage.from("arts").upload(path, it.art!.blob, { contentType: "image/png" });
      if (up.error) { toast.error(`${it.file.name}: ${up.error.message}`); continue; }
      const { error } = await supabase.from("ticket_groups").insert({
        event_id: eventId,
        name: it.name,
        recipient: it.recipient || null,
        ticket_type: it.ticketType,
        quantity: Math.max(1, it.quantity),
        price: Number(it.price.replace(",", ".")) || 0,
        source_filename: it.file.name,
        art_path: path,
        art_width: it.art!.width,
        art_height: it.art!.height,
        width_cm: it.widthCm ? parseFloat(it.widthCm.replace(",", ".")) : null,
        height_cm: it.heightCm ? parseFloat(it.heightCm.replace(",", ".")) : null,
      });
      if (error) toast.error(error.message);
      setSaving(Math.round((++n / ready.length) * 100));
    }
    toast.success(`${n} grupo(s) criados`);
    items.forEach((i) => i.art && URL.revokeObjectURL(i.art.previewUrl));
    setItems([]);
    setSaving(null);
    onDone();
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${drag ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
      >
        <FileUp className="mx-auto h-8 w-8 text-primary" />
        <p className="mt-3 font-semibold">Arraste as artes aqui ou clique para escolher</p>
        <p className="text-sm text-muted-foreground">PDF, JPG, PNG, TIFF, WEBP · até 100 ficheiros. Revise o grupo, tipo, quantidade e preço lidos do nome antes de criar.</p>
        <input ref={input} type="file" multiple accept={ACCEPTED} className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </div>

      {items.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b">
            <p className="text-sm"><b>{items.length}</b> ficheiro(s) · confira os dados lidos do nome</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setItems([])}>Limpar</Button>
              <Button onClick={save} disabled={processing || saving !== null || !items.some((i) => i.art)}>
                {processing ? <><Loader2 className="h-4 w-4 animate-spin" /> A ler…</> : "Criar grupos"}
              </Button>
            </div>
          </div>
          {saving !== null && <Progress value={saving} className="rounded-none h-1" />}
          <div className="divide-y max-h-[520px] overflow-y-auto">
            {items.map((it) => (
              <div key={it.key} className="p-3 grid grid-cols-[80px_1fr_auto] gap-3 items-center">
                <div className="h-14 w-20 rounded-md checker grid place-items-center overflow-hidden">
                  {it.art ? <img src={it.art.previewUrl} alt="" className="max-h-full max-w-full object-contain" /> : it.error ? <span className="text-[10px] text-destructive">{it.error}</span> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                  <p className="col-span-2 md:col-span-6 text-xs text-muted-foreground truncate" title={it.file.name}>{it.file.name}</p>
                  <Input className="col-span-2" value={it.name} onChange={(e) => update(it.key, { name: e.target.value })} placeholder="Grupo" />
                  <Input value={it.recipient} onChange={(e) => update(it.key, { recipient: e.target.value })} placeholder="Destinatário" />
                  <select value={it.ticketType} onChange={(e) => update(it.key, { ticketType: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                    {[...new Set([...TICKET_TYPES, it.ticketType])].map((t) => <option key={t} value={t} className="bg-popover">{t}</option>)}
                  </select>
                  <Input type="number" min={1} value={it.quantity} onChange={(e) => update(it.key, { quantity: parseInt(e.target.value) || 1 })} title="Quantidade" />
                  <Input type="number" min={0} step="1" value={it.price} onChange={(e) => update(it.key, { price: e.target.value })} placeholder="Preço Kz" aria-label="Preço por ingresso em Kz" />
                  <div className="flex items-center gap-1">
                    <Input value={it.widthCm} onChange={(e) => update(it.key, { widthCm: e.target.value })} placeholder="L cm" />
                    <span className="text-muted-foreground">×</span>
                    <Input value={it.heightCm} onChange={(e) => update(it.key, { heightCm: e.target.value })} placeholder="A cm" />
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
