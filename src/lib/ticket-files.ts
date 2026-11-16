import { jsPDF } from "jspdf";
import { encodeImage } from "utif2";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_LAYOUT, physicalMm, renderTicket } from "@/lib/render";
import type { Group, TicketRow } from "@/lib/generate";

export type TicketFileFormat = "pdf" | "jpeg" | "png" | "tiff";
export type TicketFileRequest = { group: Group; ticket: TicketRow };

const extension: Record<TicketFileFormat, string> = {
  pdf: "pdf",
  jpeg: "jpg",
  png: "png",
  tiff: "tiff",
};

function safeSegment(value: string, fallback: string) {
  const clean = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || fallback;
}

export function ticketFileName(
  eventName: string,
  groupName: string,
  ticket: Pick<TicketRow, "seq" | "code" | "holder_name">,
  format: TicketFileFormat,
) {
  const event = safeSegment(eventName, "evento");
  const group = safeSegment(groupName, "grupo");
  const reference = safeSegment(ticket.code, `ref-${ticket.seq}`);
  const holder = safeSegment(ticket.holder_name?.trim() ?? "", "sem-titular");
  return `${event}_${group}_n${String(ticket.seq).padStart(4, "0")}_${reference}_${holder}.${extension[format]}`;
}

function canvasBlob(canvas: HTMLCanvasElement, mime: "image/jpeg" | "image/png") {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível codificar a imagem."))),
      mime,
      0.94,
    );
  });
}

export async function ticketFileFromCanvas(
  canvas: HTMLCanvasElement,
  eventName: string,
  group: Group,
  ticket: TicketRow,
  format: TicketFileFormat,
) {
  const name = ticketFileName(eventName, group.name, ticket, format);
  let blob: Blob;
  if (format === "jpeg") {
    blob = await canvasBlob(canvas, "image/jpeg");
  } else if (format === "png") {
    blob = await canvasBlob(canvas, "image/png");
  } else if (format === "tiff") {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem TIFF.");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    blob = new Blob([encodeImage(new Uint8Array(pixels), canvas.width, canvas.height)], {
      type: "image/tiff",
    });
  } else {
    const mm = physicalMm(group);
    const pdf = new jsPDF({
      unit: "mm",
      format: [mm.w, mm.h],
      orientation: mm.w > mm.h ? "landscape" : "portrait",
      compress: true,
    });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, mm.w, mm.h, undefined, "FAST");
    blob = pdf.output("blob");
  }
  return new File([blob], name, { type: blob.type });
}

export async function createTicketFiles(
  items: TicketFileRequest[],
  eventName: string,
  format: TicketFileFormat,
) {
  const artByGroup = new Map<string, ImageBitmap>();
  const files: File[] = [];
  try {
    for (const { group, ticket } of items) {
      if (!group.art_path) throw new Error(`O grupo "${group.name}" não tem arte configurada.`);
      let art = artByGroup.get(group.id);
      if (!art) {
        const { data, error } = await supabase.storage.from("arts").download(group.art_path);
        if (error || !data)
          throw new Error(error?.message ?? `Arte em falta no grupo "${group.name}".`);
        art = await createImageBitmap(data);
        artByGroup.set(group.id, art);
      }
      const canvas = await renderTicket(
        art,
        group.layout ?? DEFAULT_LAYOUT,
        ticket.code,
        group.ticket_type.toUpperCase().includes("MESA") ? ticket.holder_name : null,
      );
      files.push(await ticketFileFromCanvas(canvas, eventName, group, ticket, format));
    }
  } finally {
    artByGroup.forEach((art) => art.close());
  }
  return files;
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function ticketFilesZip(files: File[], archiveName: string) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file);
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const name = `${safeSegment(archiveName, "ingressos")}.zip`;
  return new File([blob], name, { type: "application/zip" });
}

export async function downloadTicketFiles(files: File[], archiveName: string) {
  if (!files.length) throw new Error("Não há ficheiros para descarregar.");
  if (files.length === 1) {
    downloadFile(files[0]);
    return files[0];
  }
  const archive = await ticketFilesZip(files, archiveName);
  downloadFile(archive);
  return archive;
}
