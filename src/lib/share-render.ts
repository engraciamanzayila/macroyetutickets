import { DEFAULT_LAYOUT, canvasJpeg, physicalMm, renderTicket, type GroupForRender, type Layout } from "./render";

export type RenderGroup = Omit<GroupForRender, "art_path" | "layout"> & { art_url: string; ticket_type?: string; layout: unknown };

const cache = new Map<string, Promise<ImageBitmap>>();
export function artFromUrl(url: string) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  return cache.get(url)!;
}

export async function ticketImage(g: RenderGroup, code: string, holderName?: string | null) {
  const art = await artFromUrl(g.art_url);
  return renderTicket(art, (g.layout as Layout) ?? DEFAULT_LAYOUT, code, g.ticket_type?.toUpperCase().includes("MESA") ? holderName : null);
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
