import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_LAYOUT, canvasJpeg, physicalMm } from "./render";
import { renderTicket } from "./render";
import { ensureTickets, fetchAllTickets, loadArt, type Group } from "./generate";

const PW = 210, PH = 297;
const timestampKey = (value: string) => new Date(value).toISOString();

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
export type LastPrintSelection = { printedAt: string; picks: { g: Group; count: number }[]; total: number };

/** Per group: printed count and how many valid, never-printed tickets can still go to print. */
export async function printAvailability(eventId: string, groups: Group[]): Promise<PrintAvail> {
  const rows = (await fetchAllTickets({ event_id: eventId }, "id,code,seq,status,group_id,used_at,printed_at,share_id,sent_at,holder_name")) as unknown as { group_id: string; status: string; printed_at: string | null; share_id: string | null; sent_at: string | null }[];
  const out: PrintAvail = {};
  for (const g of groups) {
    const mine = rows.filter((r) => r.group_id === g.id);
    const printed = mine.filter((r) => r.printed_at).length;
    const available = mine.filter((r) => !r.printed_at && !r.share_id && !r.sent_at && r.status === "valid").length;
    out[g.id] = { printed, available: Math.max(0, available + g.quantity - mine.length) };
  }
  return out;
}

export async function lastPrintSelection(eventId: string, groups: Group[]): Promise<LastPrintSelection | null> {
  const rows = (await fetchAllTickets(
    { event_id: eventId },
    "id,code,seq,status,group_id,used_at,printed_at,share_id,sent_at,holder_name",
  )) as unknown as { group_id: string; printed_at: string | null }[];
  const printedAt = rows.reduce<string | null>(
    (latest, ticket) => ticket.printed_at && (!latest || ticket.printed_at > latest) ? ticket.printed_at : latest,
    null,
  );
  if (!printedAt) return null;
  const counts = new Map<string, number>();
  for (const ticket of rows) {
    if (ticket.printed_at === printedAt) counts.set(ticket.group_id, (counts.get(ticket.group_id) ?? 0) + 1);
  }
  const picks = groups.flatMap((g) => {
    const count = counts.get(g.id) ?? 0;
    return count ? [{ g, count }] : [];
  });
  return { printedAt, picks, total: picks.reduce((sum, pick) => sum + pick.count, 0) };
}

export async function exportForPrint(
  picks: { g: Group; count: number }[],
  fileBase: string,
  onProgress: (done: number, total: number, label: string) => void,
  eventId: string,
  reprintAt?: string,
  ticketIds?: ReadonlySet<string>,
) {
  const jobs: { g: Group; tickets: { id: string; code: string; seq: number; holder_name?: string | null }[] }[] = [];
  for (const { g, count } of picks) {
    if (count <= 0) continue;
    onProgress(0, 1, `A preparar códigos: ${g.name}`);
    await ensureTickets(g);
    const all = (await fetchAllTickets({ group_id: g.id }, "id,code,seq,status,group_id,used_at,printed_at,share_id,sent_at,holder_name")) as unknown as { id: string; code: string; seq: number; status: string; printed_at: string | null; share_id: string | null; sent_at: string | null; holder_name: string | null }[];
    const selected = reprintAt
      ? all.filter((t) => t.printed_at && timestampKey(t.printed_at) === timestampKey(reprintAt))
      : ticketIds
        ? all.filter(
            (ticket) =>
              ticketIds.has(ticket.id) &&
              ticket.status === "valid" &&
              !ticket.printed_at &&
              !ticket.share_id &&
              !ticket.sent_at,
          )
      : all.filter((t) => !t.printed_at && !t.share_id && !t.sent_at && t.status === "valid");
    jobs.push({ g, tickets: selected.slice(0, count) });
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
      let canvas = await renderTicket(art, g.layout ?? DEFAULT_LAYOUT, t.code, g.ticket_type.toUpperCase().includes("MESA") ? t.holder_name : null);
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
      pdf.setDrawColor(45, 45, 45);
      pdf.setLineWidth(0.1);
      const mark = Math.min(20, cw / 2, ch / 2);
      pdf.line(x, y, x + mark, y);
      pdf.line(x + cw - mark, y, x + cw, y);
      pdf.line(x, y + ch, x + mark, y + ch);
      pdf.line(x + cw - mark, y + ch, x + cw, y + ch);
      slot = (slot + 1) % per;
      done++;
      if (done % 5 === 0 || done === total) onProgress(done, total, `A paginar ${done}/${total}`);
      if (done % 20 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    art.close();
  }

  onProgress(total, total, "A guardar…");
  const blob = pdf.output("blob");
  const base = fileBase.replace(/[^\w\-À-ú ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "ingressos";
  const fileName = `${base}_${reprintAt ? "REIMPRESSAO" : "IMPRESSAO"}.pdf`;
  const sourcePrintedAt = reprintAt ?? new Date().toISOString();
  const ids = jobs.flatMap((j) => j.tickets.map((t) => t.id));
  const { data: user } = await supabase.auth.getUser();
  const jobId = crypto.randomUUID();
  const storagePath = `${eventId}/${jobId}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("print-files")
    .upload(storagePath, blob, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw new Error(`Não foi possível arquivar o PDF: ${uploadError.message}`);

  const { error: jobError } = await supabase.from("print_jobs").insert({
      id: jobId,
      event_id: eventId,
      created_by: user.user?.id ?? null,
      file_name: fileName,
      storage_path: storagePath,
      source_printed_at: sourcePrintedAt,
      ticket_ids: ids,
      ticket_count: total,
      page_count: pdf.getNumberOfPages(),
    });
  if (jobError) {
    await supabase.storage.from("print-files").remove([storagePath]);
    throw new Error(`Não foi possível registar o PDF no arquivo: ${jobError.message}`);
  }

  // Mark as printed only after the PDF is safely stored in the event archive.
  if (!reprintAt) {
    for (let i = 0; i < ids.length; i += 300) {
      const { error } = await supabase.from("tickets").update({ printed_at: sourcePrintedAt }).in("id", ids.slice(i, i + 300));
      if (error) throw new Error(`PDF arquivado, mas não foi possível marcar os ingressos como impressos: ${error.message}`);
    }
  }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { total, pages: pdf.getNumberOfPages() };
}
