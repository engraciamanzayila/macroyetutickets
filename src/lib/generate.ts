import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_LAYOUT,
  physicalMm,
  randomCode,
  renderTicket,
  typePrefix,
  type Layout,
} from "./render";
import { downloadFile, ticketFileFromCanvas, type TicketFileFormat } from "./ticket-files";

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

export type TicketRow = {
  id: string;
  code: string;
  seq: number;
  status: string;
  group_id: string;
  used_at: string | null;
  printed_at?: string | null;
  holder_name?: string | null;
  share_id?: string | null;
  share_token?: string;
  sent_at?: string | null;
  email_delivery_status?: string;
};

/** Fetches every row past the 1000-row API limit. */
export async function fetchAllTickets(
  filter: { event_id?: string; group_id?: string },
  columns = "id,code,seq,status,group_id,used_at,printed_at,holder_name,share_id,sent_at,email_delivery_status",
) {
  const out: TicketRow[] = [];
  const fetchPage = (from: number, selectedColumns: string) => {
    let query = supabase
      .from("tickets")
      .select(selectedColumns)
      .order("seq")
      .range(from, from + 999);
    if (filter.event_id) query = query.eq("event_id", filter.event_id);
    if (filter.group_id) query = query.eq("group_id", filter.group_id);
    return query;
  };
  for (let from = 0; ; from += 1000) {
    let page = await fetchPage(from, columns);
    if (
      page.error &&
      columns.split(",").some((column) => column.trim() === "email_delivery_status") &&
      page.error.message.includes("email_delivery_status")
    ) {
      const compatibleColumns = columns
        .split(",")
        .filter((column) => column.trim() !== "email_delivery_status")
        .join(",");
      page = await fetchPage(from, compatibleColumns);
    }
    if (page.error) throw page.error;
    const data = page.data;
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
export type OutputFormat = TicketFileFormat | "a4";

const safe = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "ingressos";

export async function generate(
  groups: Group[],
  formats: OutputFormat[],
  fileBase: string,
  onProgress: Progress,
  ticketIds?: ReadonlySet<string>,
) {
  const fileFormats = [
    ...new Set(formats.filter((format): format is TicketFileFormat => format !== "a4")),
  ];
  const makeA4 = formats.includes("a4");
  const jobs: { g: Group; tickets: TicketRow[] }[] = [];
  for (const g of groups) {
    onProgress(0, 1, `A verificar códigos: ${g.name}`);
    jobs.push({
      g,
      tickets: (await ensureTickets(g)).filter(
        (ticket) =>
          ticket.status === "valid" &&
          !ticket.printed_at &&
          !ticket.share_id &&
          !ticket.sent_at &&
          ticket.email_delivery_status !== "sending" &&
          ticket.email_delivery_status !== "sent" &&
          (!ticketIds || ticketIds.has(ticket.id)),
      ),
    });
  }
  const total = jobs.reduce((sum, job) => sum + job.tickets.length, 0);
  if (!total) return 0;

  const { default: JSZip } = fileFormats.length ? await import("jszip") : { default: null };
  const zip = JSZip ? new JSZip() : null;
  let singleFile: File | null = null;
  let digitalFileCount = 0;
  let a4: InstanceType<typeof import("jspdf").jsPDF> | null = null;
  let a4Slot = 0;
  let a4Pages = 0;
  let done = 0;
  const M = 8;
  const GAP = 3;
  const PW = 210;
  const PH = 297;

  for (const { g, tickets } of jobs) {
    if (!tickets.length) continue;
    if (!g.art_path) throw new Error(`O grupo "${g.name}" não tem arte configurada.`);
    const art = await loadArt(g.art_path);
    try {
      const layout = g.layout ?? DEFAULT_LAYOUT;
      const mm = physicalMm(g);
      let cols = Math.floor((PW - 2 * M + GAP) / (mm.w + GAP));
      let rows = Math.floor((PH - 2 * M + GAP) / (mm.h + GAP));
      let rotated = false;
      const colsRotated = Math.floor((PW - 2 * M + GAP) / (mm.h + GAP));
      const rowsRotated = Math.floor((PH - 2 * M + GAP) / (mm.w + GAP));
      if (colsRotated * rowsRotated > cols * rows) {
        cols = colsRotated;
        rows = rowsRotated;
        rotated = true;
      }
      cols = Math.max(1, cols);
      rows = Math.max(1, rows);
      const perPage = cols * rows;
      a4Slot = 0;

      for (const ticket of tickets) {
        const canvas = await renderTicket(
          art,
          layout,
          ticket.code,
          g.ticket_type.toUpperCase().includes("MESA") ? ticket.holder_name : null,
        );
        for (const format of fileFormats) {
          const file = await ticketFileFromCanvas(canvas, fileBase, g, ticket, format);
          if (!zip) throw new Error("Não foi possível preparar o pacote dos ficheiros.");
          zip.file(`${safe(g.name)}/${file.name}`, file);
          singleFile = file;
          digitalFileCount++;
        }

        if (makeA4) {
          if (!a4) {
            const { jsPDF } = await import("jspdf");
            a4 = new jsPDF({ unit: "mm", format: "a4", compress: true });
            a4Pages = 1;
          } else if (a4Slot === 0) {
            a4.addPage("a4", "portrait");
            a4Pages++;
          }
          const c = a4Slot % cols;
          const r = Math.floor(a4Slot / cols);
          const cw = rotated ? mm.h : mm.w;
          const ch = rotated ? mm.w : mm.h;
          const usedW = cols * cw + (cols - 1) * GAP;
          const usedH = rows * ch + (rows - 1) * GAP;
          const x = (PW - usedW) / 2 + c * (cw + GAP);
          const y = (PH - usedH) / 2 + r * (ch + GAP);
          let printCanvas = canvas;
          if (rotated) {
            const rotatedCanvas = document.createElement("canvas");
            rotatedCanvas.width = canvas.height;
            rotatedCanvas.height = canvas.width;
            const context = rotatedCanvas.getContext("2d");
            if (!context) throw new Error("Não foi possível preparar a folha A4.");
            context.translate(rotatedCanvas.width, 0);
            context.rotate(Math.PI / 2);
            context.drawImage(canvas, 0, 0);
            printCanvas = rotatedCanvas;
          }
          a4.addImage(
            printCanvas.toDataURL("image/jpeg", 0.92),
            "JPEG",
            x,
            y,
            cw,
            ch,
            undefined,
            "FAST",
          );
          a4.setDrawColor(45, 45, 45);
          a4.setLineWidth(0.1);
          const mark = Math.min(2, cw / 8);
          a4.line(x, y, x + mark, y);
          a4.line(x + cw - mark, y, x + cw, y);
          a4.line(x, y + ch, x + mark, y + ch);
          a4.line(x + cw - mark, y + ch, x + cw, y + ch);
          a4Slot = (a4Slot + 1) % perPage;
        }
        done++;
        if (done % 5 === 0 || done === total) onProgress(done, total, `A gerar ${done}/${total}`);
        if (done % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      art.close();
    }
  }

  onProgress(total, total, "A preparar os ficheiros…");
  if (zip && digitalFileCount) {
    if (digitalFileCount === 1 && singleFile) {
      downloadFile(singleFile);
    } else {
      const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
      downloadFile(
        new File([archive], `${safe(fileBase)}_bilhetes.zip`, { type: "application/zip" }),
      );
    }
  }
  if (a4) {
    const printFile = new File([a4.output("blob")], `${safe(fileBase)}_A4_${a4Pages}_paginas.pdf`, {
      type: "application/pdf",
    });
    downloadFile(printFile);
  }
  return total;
}
