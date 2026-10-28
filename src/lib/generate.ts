import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_LAYOUT, canvasJpeg, physicalMm, randomCode, renderTicket, typePrefix, type Layout } from "./render";

export type Group = {
  id: string;
  event_id: string;
  name: string;
  ticket_type: string;
  recipient: string | null;
  quantity: number;
  price?: number;
  for_sale?: boolean;
  art_path: string | null;
  art_width: number | null;
  art_height: number | null;
  width_cm: number | null;
  height_cm: number | null;
  layout: Layout | null;
};

export type TicketRow = { id: string; code: string; seq: number; status: string; group_id: string; used_at: string | null; printed_at?: string | null; holder_name?: string | null; share_id?: string | null; sent_at?: string | null };

/** Fetches every row past the 1000-row API limit. */
export async function fetchAllTickets(filter: { event_id?: string; group_id?: string }, columns = "id,code,seq,status,group_id,used_at,printed_at,holder_name,share_id,sent_at") {
  const out: TicketRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("tickets").select(columns).order("seq").range(from, from + 999);
    if (filter.event_id) q = q.eq("event_id", filter.event_id);
    if (filter.group_id) q = q.eq("group_id", filter.group_id);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as unknown as TicketRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Creates missing tickets so the group has exactly `quantity` unique codes (never deletes). */
export async function ensureTickets(g: Group) {
  const existing = await fetchAllTickets({ group_id: g.id });
  const missing = g.quantity - existing.length;
  if (missing > 0) {
    const prefix = typePrefix(g.ticket_type);
    let seq = existing.reduce((m, t) => Math.max(m, t.seq), 0);
    const rows = Array.from({ length: missing }, () => ({
      event_id: g.event_id,
      group_id: g.id,
      code: randomCode(prefix),
      seq: ++seq,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("tickets").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
  }
  return (await fetchAllTickets({ group_id: g.id })).slice(0, Math.max(g.quantity, 0));
}

export async function loadArt(path: string) {
  const { data, error } = await supabase.storage.from("arts").download(path);
  if (error || !data) throw error ?? new Error("Arte não encontrada");
  return createImageBitmap(data);
}

export async function artUrl(path: string) {
  const { data } = await supabase.storage.from("arts").createSignedUrl(path, 3600);
  return data?.signedUrl ?? "";
}

type Progress = (done: number, total: number, label: string) => void;
export type OutputFormat = "zip" | "pdf" | "a4";

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const safe = (s: string) => s.replace(/[^\w\-À-ú ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "ingressos";

export async function generate(groups: Group[], formats: OutputFormat[], fileBase: string, onProgress: Progress) {
  const jobs: { g: Group; tickets: TicketRow[] }[] = [];
  for (const g of groups) {
    onProgress(0, 1, `A criar códigos: ${g.name}`);
    jobs.push({ g, tickets: (await ensureTickets(g)).filter((t) => t.status === "valid" && !t.printed_at && !t.share_id && !t.sent_at) });
  }
  const total = jobs.reduce((s, j) => s + j.tickets.length, 0);
  const [{ default: JSZip }, { jsPDF }] = await Promise.all([import("jszip"), import("jspdf")]);
  const zip = formats.includes("zip") ? new JSZip() : null;
  let pdf: InstanceType<typeof jsPDF> | null = null;
  let a4: InstanceType<typeof jsPDF> | null = null;
  let a4Slot = 0;
  let a4Pages = 0;
  let done = 0;

  for (const { g, tickets } of jobs) {
    if (!g.art_path) continue;
    const art = await loadArt(g.art_path);
    const layout = g.layout ?? DEFAULT_LAYOUT;
    const mm = physicalMm(g);
    const orient = mm.w > mm.h ? "landscape" : "portrait";
    // A4 grid for this group
    const M = 8, GAP = 3, PW = 210, PH = 297;
    let cols = Math.floor((PW - 2 * M + GAP) / (mm.w + GAP));
    let rows = Math.floor((PH - 2 * M + GAP) / (mm.h + GAP));
    let rot = false;
    const colsR = Math.floor((PW - 2 * M + GAP) / (mm.h + GAP));
    const rowsR = Math.floor((PH - 2 * M + GAP) / (mm.w + GAP));
    if (colsR * rowsR > cols * rows) { cols = colsR; rows = rowsR; rot = true; }
    const per = Math.max(1, cols * rows);
    a4Slot = 0; // each group starts on a new sheet

    for (const t of tickets) {
      const canvas = await renderTicket(art, layout, t.code, g.ticket_type.toUpperCase().includes("MESA") ? t.holder_name : null);
      const blob = await canvasJpeg(canvas, 0.9);
      if (zip) zip.file(`${safe(g.name)}/${String(t.seq).padStart(4, "0")}_${t.code}.jpg`, blob);
      if (formats.includes("pdf") || formats.includes("a4")) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (formats.includes("pdf")) {
          if (!pdf) pdf = new jsPDF({ unit: "mm", format: [mm.w, mm.h], orientation: orient, compress: true });
          else pdf.addPage([mm.w, mm.h], orient);
          pdf.addImage(bytes, "JPEG", 0, 0, mm.w, mm.h, undefined, "FAST");
        }
        if (formats.includes("a4")) {
          if (!a4) { a4 = new jsPDF({ unit: "mm", format: "a4", compress: true }); a4Pages = 1; }
          else if (a4Slot === 0) { a4.addPage("a4", "portrait"); a4Pages++; }
          const c = a4Slot % cols, r = Math.floor(a4Slot / cols);
          const cw = rot ? mm.h : mm.w, ch = rot ? mm.w : mm.h;
          const usedW = cols * cw + (cols - 1) * GAP, usedH = rows * ch + (rows - 1) * GAP;
          const x = (PW - usedW) / 2 + c * (cw + GAP);
          const y = (PH - usedH) / 2 + r * (ch + GAP);
          if (rot) {
            const rc = document.createElement("canvas");
            rc.width = canvas.height;
            rc.height = canvas.width;
            const rx = rc.getContext("2d")!;
            rx.translate(rc.width, 0);
            rx.rotate(Math.PI / 2);
            rx.drawImage(canvas, 0, 0);
            const rb = new Uint8Array(await (await canvasJpeg(rc, 0.9)).arrayBuffer());
            a4.addImage(rb, "JPEG", x, y, cw, ch, undefined, "FAST");
          } else a4.addImage(bytes, "JPEG", x, y, mm.w, mm.h, undefined, "FAST");
          a4Slot = (a4Slot + 1) % per;
        }
      }
      done++;
      if (done % 5 === 0 || done === total) onProgress(done, total, `A gerar ${done}/${total}`);
      if (done % 20 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    art.close();
  }
  void a4Pages;
  onProgress(total, total, "A preparar downloads…");
  const base = safe(fileBase);
  if (zip) save(await zip.generateAsync({ type: "blob", compression: "STORE" }), `${base}.zip`);
  if (pdf) save(pdf.output("blob"), `${base}.pdf`);
  if (a4) save(a4.output("blob"), `${base}_A4.pdf`);
  return total;
}
