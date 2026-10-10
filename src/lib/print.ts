import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_LAYOUT, canvasJpeg, physicalMm } from "./render";
import { renderTicket } from "./render";
import { ensureTickets, fetchAllTickets, loadArt, type Group } from "./generate";

const PW = 210, PH = 297;

/** Best A4 grid for a ticket of w×h mm. Tries normal/rotated and tight margins so 21 cm tickets fit full width. */
export function a4Grid(w: number, h: number) {
  let best = { cols: 0, rows: 0, rot: false, gap: 0 };
  for (const rot of [false, true]) {
    const cw = rot ? h : w, ch = rot ? w : h;
    for (const [m, gap] of [[6, 2], [3, 1], [0, 0]] as const) {
      const cols = Math.floor((PW - 2 * m + gap + 0.5) / (cw + gap));
      const rows = Math.floor((PH - 2 * m + gap + 0.5) / (ch + gap));
      if (cols * rows > best.cols * best.rows) best = { cols, rows, rot, gap };
    }
  }
  if (best.cols * best.rows === 0) best = { cols: 1, rows: 1, rot: false, gap: 0 };
  return best;
}

export type PrintAvail = Record<string, { printed: number; available: number }>;

/** Per group: printed count and how many valid, never-printed tickets can still go to print. */
export async function printAvailability(eventId: string, groups: Group[]): Promise<PrintAvail> {
  const rows = (await fetchAllTickets({ event_id: eventId }, "id,code,seq,status,group_id,used_at,printed_at")) as unknown as { group_id: string; status: string; printed_at: string | null }[];
  const out: PrintAvail = {};
  for (const g of groups) {
    const mine = rows.filter((r) => r.group_id === g.id);
    const printed = mine.filter((r) => r.printed_at).length;
    const voided = mine.filter((r) => !r.printed_at && r.status === "void").length;
    out[g.id] = { printed, available: Math.max(0, g.quantity - printed - voided) };
  }
  return out;
}

export async function exportForPrint(
  picks: { g: Group; count: number }[],
  fileBase: string,
  onProgress: (done: number, total: number, label: string) => void,
) {
  const jobs: { g: Group; tickets: { id: string; code: string; seq: number }[] }[] = [];
  for (const { g, count } of picks) {
    if (count <= 0) continue;
    onProgress(0, 1, `A preparar códigos: ${g.name}`);
    await ensureTickets(g);
    const all = (await fetchAllTickets({ group_id: g.id }, "id,code,seq,status,group_id,used_at,printed_at")) as unknown as { id: string; code: string; seq: number; status: string; printed_at: string | null }[];
    jobs.push({ g, tickets: all.filter((t) => !t.printed_at && t.status !== "void").slice(0, count) });
  }
  const total = jobs.reduce((s, j) => s + j.tickets.length, 0);
  if (!total) throw new Error("Nada para imprimir");
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  let first = true, slot = 0, per = 1, done = 0;
  let lastKey = "";

  for (const { g, tickets } of jobs) {
    if (!g.art_path || !tickets.length) continue;
    const art = await loadArt(g.art_path);
    const mm = physicalMm(g);
    const grid = a4Grid(mm.w, mm.h);
    const key = `${mm.w}x${mm.h}`;
    // Different size → start a fresh sheet; same size continues filling the sheet in order.
    if (key !== lastKey) { if (!first) slot = 0; lastKey = key; }
    per = grid.cols * grid.rows;
    const cw = grid.rot ? mm.h : mm.w, ch = grid.rot ? mm.w : mm.h;
    const usedW = grid.cols * cw + (grid.cols - 1) * grid.gap;
    const usedH = grid.rows * ch + (grid.rows - 1) * grid.gap;

    for (const t of tickets) {
      if (first) first = false;
      else if (slot === 0) pdf.addPage("a4", "portrait");
      let canvas = await renderTicket(art, g.layout ?? DEFAULT_LAYOUT, t.code);
      if (grid.rot) {
        const rc = document.createElement("canvas");
        rc.width = canvas.height; rc.height = canvas.width;
        const rx = rc.getContext("2d")!;
        rx.translate(rc.width, 0); rx.rotate(Math.PI / 2); rx.drawImage(canvas, 0, 0);
        canvas = rc;
      }
      const bytes = new Uint8Array(await (await canvasJpeg(canvas, 0.92)).arrayBuffer());
      const c = slot % grid.cols, r = Math.floor(slot / grid.cols);
      const x = (PW - usedW) / 2 + c * (cw + grid.gap);
      const y = (PH - usedH) / 2 + r * (ch + grid.gap);
      pdf.addImage(bytes, "JPEG", x, y, cw, ch, undefined, "FAST");
      slot = (slot + 1) % per;
      done++;
      if (done % 5 === 0 || done === total) onProgress(done, total, `A paginar ${done}/${total}`);
      if (done % 20 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    art.close();
  }

  onProgress(total, total, "A guardar…");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(pdf.output("blob"));
  a.download = `${fileBase.replace(/[^\w\-À-ú ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "ingressos"}_IMPRESSAO.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);

  // Mark as printed so they are excluded from future digital downloads.
  const ids = jobs.flatMap((j) => j.tickets.map((t) => t.id));
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 300) {
    const { error } = await supabase.from("tickets").update({ printed_at: now }).in("id", ids.slice(i, i + 300));
    if (error) throw error;
  }
  return { total, pages: pdf.getNumberOfPages() };
}
