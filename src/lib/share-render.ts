import { DEFAULT_LAYOUT, canvasJpeg, physicalMm, renderTicket, type GroupForRender, type Layout } from "./render";

export type RenderGroup = Omit<GroupForRender, "art_path" | "layout"> & { art_url: string; ticket_type?: string; layout: unknown };

const cache = new Map<string, Promise<ImageBitmap>>();
export function artFromUrl(url: string) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  return cache.get(url)!;
}

export async function ticketImage(g: RenderGroup, code: string, holderName?: string | null) {
  const art = await artFromUrl(g.art_url);
  return renderTicket(art, (g.layout as Layout) ?? DEFAULT_LAYOUT, code, holderName);
}

/** Build the same multi-page ticket PDF as base64 for secure email delivery. */
export async function createPdfBase64(items: { g: RenderGroup; code: string; holderName?: string | null }[]) {
  const { jsPDF } = await import("jspdf");
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const { g, code, holderName } of items) {
    const mm = physicalMm({ ...g, art_path: null, layout: null });
    const orientation = mm.w > mm.h ? "landscape" : "portrait";
    const canvas = await ticketImage(g, code, holderName);
    const bytes = new Uint8Array(await (await canvasJpeg(canvas, 0.92)).arrayBuffer());
    if (!pdf) pdf = new jsPDF({ unit: "mm", format: [mm.w, mm.h], orientation, compress: true });
    else pdf.addPage([mm.w, mm.h], orientation);
    pdf.addImage(bytes, "JPEG", 0, 0, mm.w, mm.h, undefined, "FAST");
  }
  if (!pdf) throw new Error("Não há ingressos para anexar.");
  const blob = pdf.output("blob");
  if (blob.size > 3_000_000) throw new Error("O PDF ultrapassa o limite seguro de envio por e-mail.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** One ticket per page, real size, downloaded as a single PDF. */
export async function downloadPdf(items: { g: RenderGroup; code: string; holderName?: string | null }[], name: string) {
  const { jsPDF } = await import("jspdf");
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const { g, code, holderName } of items) {
    const mm = physicalMm({ ...g, art_path: null, layout: null });
    const o = mm.w > mm.h ? "landscape" : "portrait";
    const c = await ticketImage(g, code, holderName);
    const bytes = new Uint8Array(await (await canvasJpeg(c, 0.92)).arrayBuffer());
    if (!pdf) pdf = new jsPDF({ unit: "mm", format: [mm.w, mm.h], orientation: o, compress: true });
    else pdf.addPage([mm.w, mm.h], o);
    pdf.addImage(bytes, "JPEG", 0, 0, mm.w, mm.h, undefined, "FAST");
  }
  if (!pdf) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(pdf.output("blob"));
  a.download = `${name.replace(/[^\w\-À-ú ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "ingressos"}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const holderLink = (tokens: string[]) => `${window.location.origin}/i/${tokens.join(",")}`;
