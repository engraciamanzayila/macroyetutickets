import { useEffect, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { CarFront, Download, Plus, Printer, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Pass = { id: string; reference_code: string; qr_token: string; status: string; vehicle_plate: string | null; checked_in_at: string | null };

const makeReference = () => `MYT-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
const cleanPlate = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

export function FreeTransitPanel({ eventId, eventName, eventCoverUrl }: { eventId: string; eventName: string; eventCoverUrl?: string | null }) {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [ref, setRef] = useState("");
  const [plate, setPlate] = useState("");
  const [checking, setChecking] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const allPasses: Pass[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await (supabase as any).from("event_free_transit_passes")
        .select("id,reference_code,qr_token,status,vehicle_plate,checked_in_at")
        .eq("event_id", eventId).order("reference_code").range(from, from + 999);
      if (error) {
        setLoading(false);
        return toast.error("Não foi possível carregar os passes: " + error.message);
      }
      allPasses.push(...((data ?? []) as Pass[]));
      if (!data || data.length < 1000) break;
    }
    setPasses(allPasses);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [eventId]);

  const generatePasses = async () => {
    const requested = Number(quantity);
    if (!Number.isSafeInteger(requested) || requested < 1) return toast.error("Indique uma quantidade válida, maior que zero.");
    setGenerating(true);
    let created = 0;
    try {
      // Inserção em lotes para permitir quantidades grandes sem apagar passes existentes.
      for (let offset = 0; offset < requested; offset += 500) {
        const size = Math.min(500, requested - offset);
        const rows = Array.from({ length: size }, () => ({
          event_id: eventId,
          reference_code: makeReference(),
          qr_token: crypto.randomUUID(),
          status: "active",
        }));
        const { error } = await (supabase as any).from("event_free_transit_passes").insert(rows);
        if (error) throw error;
        created += rows.length;
      }
      toast.success(`${created} novo(s) passe(s) criado(s). Os anteriores foram preservados.`);
      await refresh();
    } catch (error) {
      toast.error(`Foram criados ${created} passe(s); falha no lote seguinte: ${(error as Error).message}`);
      await refresh();
    } finally {
      setGenerating(false);
    }
  };

  const checkIn = async () => {
    const normalizedRef = ref.trim().toUpperCase();
    const normalizedPlate = cleanPlate(plate);
    if (!normalizedRef || normalizedPlate.length < 5) return toast.error("Indique a referência e uma matrícula válida.");
    setChecking(true);
    const pass = passes.find((item) => item.reference_code === normalizedRef);
    if (!pass) { setChecking(false); return toast.error("Referência não encontrada neste evento."); }
    const { data, error } = await (supabase as any).rpc("check_in_free_transit", { p_token: pass.qr_token, p_plate: normalizedPlate });
    setChecking(false);
    if (error) return toast.error("Não foi possível validar: " + error.message);
    if (data?.result === "ok") toast.success("Entrada autorizada. Matrícula associada ao passe.");
    else if (data?.result === "same_vehicle") toast.warning("Este passe já foi utilizado por esta mesma viatura.");
    else if (data?.result === "different_vehicle") toast.error(`Passe bloqueado: já associado à matrícula ${data.vehicle_plate}.`);
    else if (data?.result === "void") toast.error("Este passe foi cancelado.");
    else toast.error("Passe inválido ou não encontrado.");
    setRef("");
    setPlate("");
    await refresh();
  };

  const exportPdf = async () => {
    if (!passes.length) return toast.error("Ainda não existem passes para imprimir.");
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const cardW = 105, cardH = 148;
    let eventArt: string | null = null;
    if (eventCoverUrl) {
      try {
        const response = await fetch(eventCoverUrl);
        if (!response.ok) throw new Error("A arte do evento não está acessível.");
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Não foi possível preparar a arte.");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        eventArt = canvas.toDataURL("image/png");
      } catch (error) {
        toast.warning("A arte do evento não foi incluída nos passes: " + (error as Error).message);
      }
    }
    for (let i = 0; i < passes.length; i++) {
      if (i > 0 && i % 4 === 0) pdf.addPage();
      const x = (i % 2) * cardW, y = Math.floor((i % 4) / 2) * cardH;
      const pass = passes[i];
      const qr = await QRCode.toDataURL(`${window.location.origin}/livre-transito/${pass.qr_token}`, { width: 420, margin: 1, errorCorrectionLevel: "H" });
      pdf.setFillColor(255, 255, 255); pdf.rect(x, y, cardW, cardH, "F");
      pdf.setDrawColor(31, 55, 91); pdf.setLineWidth(0.7); pdf.roundedRect(x + 4, y + 4, cardW - 8, cardH - 8, 3, 3, "S");
      pdf.setFillColor(20, 45, 89); pdf.roundedRect(x + 4, y + 4, cardW - 8, 10, 2, 2, "F");
      pdf.setTextColor(255, 255, 255); pdf.setFont("helvetica", "bold"); pdf.setFontSize(7);
      pdf.text("PASSE OFICIAL DE ESTACIONAMENTO", x + 8, y + 11);
      const artX = x + 8, artY = y + 20, artW = 39, artH = 39;
      pdf.setFillColor(247, 249, 252); pdf.rect(artX, artY, artW, artH, "F");
      pdf.setDrawColor(215, 222, 234); pdf.rect(artX, artY, artW, artH, "S");
      if (eventArt) {
        const props = pdf.getImageProperties(eventArt);
        const scale = Math.min((artW - 2) / props.width, (artH - 2) / props.height);
        const drawW = props.width * scale, drawH = props.height * scale;
        pdf.addImage(eventArt, "PNG", artX + (artW - drawW) / 2, artY + (artH - drawH) / 2, drawW, drawH);
      } else {
        pdf.setTextColor(100, 116, 139); pdf.setFontSize(6); pdf.text("ARTE DO EVENTO", artX + 4, artY + 20);
      }
      pdf.setFillColor(255, 255, 255); pdf.rect(x + 54, y + 19, 43, 43, "F");
      pdf.setDrawColor(215, 222, 234); pdf.rect(x + 54, y + 19, 43, 43, "S");
      pdf.addImage(qr, "PNG", x + 59, y + 24, 33, 33);
      pdf.setTextColor(20, 45, 89); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11);
      pdf.text("LIVRE-TRÂNSITO", x + 8, y + 69);
      pdf.setTextColor(71, 85, 105); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
      pdf.text("EVENTO", x + 8, y + 76);
      pdf.setTextColor(23, 32, 51); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
      pdf.text(pdf.splitTextToSize(eventName, 88), x + 8, y + 83);
      pdf.setTextColor(71, 85, 105); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
      pdf.text("REFERÊNCIA", x + 8, y + 99);
      pdf.setTextColor(20, 45, 89); pdf.setFont("helvetica", "bold"); pdf.setFontSize(13);
      pdf.text(pass.reference_code, x + 8, y + 106);
      pdf.setDrawColor(215, 222, 234); pdf.line(x + 8, y + 111, x + 97, y + 111);
      pdf.setTextColor(71, 85, 105); pdf.setFont("helvetica", "normal"); pdf.setFontSize(6);
      pdf.text("MATRÍCULA A REGISTAR NA ENTRADA", x + 8, y + 119);
      pdf.setDrawColor(100, 116, 139); pdf.line(x + 8, y + 128, x + 54, y + 128);
      pdf.setTextColor(20, 45, 89); pdf.setFont("helvetica", "bold"); pdf.setFontSize(7);
      pdf.text("MY TICKETS", x + 8, y + 139);
      pdf.setTextColor(100, 116, 139); pdf.setFont("helvetica", "normal"); pdf.setFontSize(5);
      pdf.text("Passe individual e intransmissível", x + 97, y + 139, { align: "right" });
      pdf.setDrawColor(130, 130, 130); pdf.setLineWidth(0.2); pdf.setLineDashPattern([1, 1], 0);
      pdf.rect(x + 1, y + 1, cardW - 2, cardH - 2);
      pdf.setLineDashPattern([], 0);
    }
    const safeEventName = eventName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 70) || "EVENTO";
    pdf.save(`${safeEventName}-${passes.length}-PASSES-ESTACIONAMENTO-A6.pdf`);
  };

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card p-5">
      <div className="min-w-[220px] flex-1"><div className="flex items-center gap-2 font-semibold"><CarFront className="size-5 text-primary" /> Passes de livre-trânsito</div><p className="mt-1 text-sm text-muted-foreground">Gera a quantidade necessária em cada lote. Os passes anteriores são preservados · formato A6 · 4 por folha A4.</p><p className="mt-1 text-xs text-muted-foreground">{passes.length} passe(s) já criados neste evento.</p></div>
      <div className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-xs"><span>Quantidade a acrescentar</span><Input type="number" min="1" step="1" value={quantity} placeholder="Quantidade" disabled={generating} onChange={(e) => setQuantity(e.target.value)} className="w-36" /></label><Button onClick={generatePasses} disabled={generating || !quantity || Number(quantity) < 1}><Plus className="mr-2 size-4" />{generating ? "A gerar…" : "Gerar passes"}</Button><Button variant="outline" onClick={exportPdf} disabled={!passes.length || generating}><Printer className="mr-2 size-4" />Imprimir todos ({passes.length})</Button></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {passes.map((pass) => <div key={pass.id} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><b className="font-mono">{pass.reference_code}</b><span className={pass.status === "active" ? "text-xs text-emerald-600" : "text-xs text-muted-foreground"}>{pass.status === "active" ? "Disponível" : pass.status === "used" ? "Utilizado" : "Cancelado"}</span></div><p className="mt-2 text-sm text-muted-foreground">Matrícula: <b className="text-foreground">{pass.vehicle_plate || "Por registar"}</b></p></div>)}
    </div>
    {loading && <p className="text-sm text-muted-foreground">A carregar passes…</p>}
    {passes.length === 0 && !loading && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Ainda não existem passes para este evento.</p>}
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-primary" /> Registar entrada da viatura</div>
      <p className="mt-1 text-sm text-muted-foreground">O promotor lê o QR ou introduz a referência e regista a matrícula. A primeira matrícula fica permanentemente associada ao passe.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input className="h-10 rounded-md border bg-background px-3 text-sm uppercase" placeholder="Referência do passe" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} />
        <input className="h-10 rounded-md border bg-background px-3 text-sm uppercase" placeholder="Matrícula (ex.: LD-12-34-AB)" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
        <Button onClick={checkIn} disabled={checking || !passes.length}>{checking ? "A validar…" : "Validar entrada"}</Button>
      </div>
    </div>
  </section>;
}
