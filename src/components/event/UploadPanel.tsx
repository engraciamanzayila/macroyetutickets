import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { processArt, ACCEPTED, type ProcessedArt } from "@/lib/art";
import { parseFilename, TICKET_TYPES } from "@/lib/filename";
import { createStandardTicketArt, STANDARD_TICKET_LAYOUT } from "@/lib/render";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

type EventDetails = {
  name: string;
  event_date: string | null;
  event_time: string | null;
  venue: string | null;
  city: string | null;
  category: string | null;
  cover_url: string | null;
};

export function UploadPanel({ eventId, event, onDone }: { eventId: string; event?: EventDetails | null; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [standardOpen, setStandardOpen] = useState(false);
  const [creatingStandard, setCreatingStandard] = useState(false);
  const [standardForm, setStandardForm] = useState({ name: "Normal", ticketType: "Normal", quantity: "1", price: "0" });
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

  const createStandardGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return toast.error("Os dados do evento ainda estão a carregar.");
    const quantity = Number(standardForm.quantity);
    const price = Number(standardForm.price.replace(",", "."));
    if (!standardForm.name.trim()) return toast.error("Indique o nome do grupo.");
    if (!Number.isSafeInteger(quantity) || quantity < 1) return toast.error("Indique uma quantidade inteira maior que zero.");
    if (!Number.isFinite(price) || price < 0) return toast.error("Indique um preço válido.");

    setCreatingStandard(true);
    let path: string | null = null;
    let artUploaded = false;
    try {
      const art = await createStandardTicketArt({
        eventName: event.name,
        eventDate: event.event_date,
        eventTime: event.event_time,
        venue: event.venue,
        city: event.city,
        category: event.category,
        coverUrl: event.cover_url,
        groupName: standardForm.name.trim(),
        ticketType: standardForm.ticketType,
        price,
      });
      path = `${eventId}/${crypto.randomUUID()}.png`;
      const { error: uploadError } = await supabase.storage.from("arts").upload(path, art, { contentType: "image/png" });
      if (uploadError) throw uploadError;
      artUploaded = true;

      const { error } = await supabase.from("ticket_groups").insert({
        event_id: eventId,
        name: standardForm.name.trim(),
        ticket_type: standardForm.ticketType,
        quantity,
        price,
        source_filename: "Modelo padrão MY Tickets",
        art_path: path,
        art_width: 900,
        art_height: 1600,
        width_cm: 9,
        height_cm: 16,
        layout: STANDARD_TICKET_LAYOUT as never,
      });
      if (error) throw error;

      toast.success("Grupo criado com o modelo padrão MY Tickets");
      setStandardOpen(false);
      setStandardForm({ name: "Normal", ticketType: "Normal", quantity: "1", price: "0" });
      onDone();
    } catch (error) {
      let cleanupError = "";
      if (path && artUploaded) {
        const { error: removeError } = await supabase.storage.from("arts").remove([path]);
        if (removeError) cleanupError = ` Também não foi possível remover a arte: ${removeError.message}`;
      }
      toast.error(`Não foi possível criar o grupo: ${(error as Error).message}.${cleanupError}`);
    } finally {
      setCreatingStandard(false);
    }
  };

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Escolha um modelo MY Tickets ou carregue a sua própria arte.</p>
        <Button variant="secondary" onClick={() => setStandardOpen(true)} disabled={!event || creatingStandard}>
          Usar modelo MY Tickets
        </Button>
      </div>
      <Dialog open={standardOpen} onOpenChange={(open) => !creatingStandard && setStandardOpen(open)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo grupo com modelo MY Tickets</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            O ingresso incluirá a capa e os dados do evento, o tipo de ingresso, o QR code, a referência e a marca MY Tickets.
          </p>
          <form onSubmit={createStandardGroup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="standard-group-name">Nome do grupo</Label>
              <Input id="standard-group-name" required value={standardForm.name} onChange={(e) => setStandardForm({ ...standardForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="standard-ticket-type">Tipo de ingresso</Label>
                <select id="standard-ticket-type" value={standardForm.ticketType} onChange={(e) => setStandardForm({ ...standardForm, ticketType: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {[...new Set([...TICKET_TYPES, standardForm.ticketType])].map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="standard-ticket-quantity">Quantidade</Label>
                <Input id="standard-ticket-quantity" type="number" min={1} step={1} required value={standardForm.quantity} onChange={(e) => setStandardForm({ ...standardForm, quantity: e.target.value })} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="standard-ticket-price">Preço por ingresso (Kz)</Label>
                <Input id="standard-ticket-price" type="number" min={0} step={1} required value={standardForm.price} onChange={(e) => setStandardForm({ ...standardForm, price: e.target.value })} />
              </div>
            </div>
            <Button className="w-full" disabled={creatingStandard}>
              {creatingStandard ? "A criar grupo…" : "Criar grupo com modelo"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
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
