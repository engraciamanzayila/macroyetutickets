import QRCode from "qrcode";

export type Layout = {
  qr: { x: number; y: number; w: number; dark: string; light: string };
  code: { x: number; y: number; size: number; color: string; show: boolean; bold: boolean };
};

export const DEFAULT_LAYOUT: Layout = {
  qr: { x: 0.8, y: 0.2, w: 0.14, dark: "#000000", light: "#ffffff" },
  code: { x: 0.87, y: 0.85, size: 0.06, color: "#000000", show: true, bold: true },
};

export type GroupForRender = {
  art_path: string | null;
  art_width: number | null;
  art_height: number | null;
  width_cm: number | null;
  height_cm: number | null;
  layout: Layout | null;
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomCode(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}
export function typePrefix(type: string) {
  const t = type.toUpperCase();
  if (t.includes("PÉ") || t.includes("PE")) return t.startsWith("VIP") ? "VEP" : "MYT";
  if (t.startsWith("VIP")) return "VIP";
  if (t.startsWith("MESA")) return "MSA";
  if (t.startsWith("CONV")) return "CNV";
  if (t.startsWith("BACK")) return "BKS";
  if (t.startsWith("NORM")) return "NRM";
  return "MYT";
}

/** Physical size in mm (falls back to 300 dpi). */
export function physicalMm(g: GroupForRender) {
  if (g.width_cm && g.height_cm) return { w: Number(g.width_cm) * 10, h: Number(g.height_cm) * 10 };
  return { w: ((g.art_width ?? 1000) / 300) * 25.4, h: ((g.art_height ?? 1000) / 300) * 25.4 };
}

export async function renderTicket(art: ImageBitmap, layout: Layout, code: string): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = art.width;
  c.height = art.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(art, 0, 0);
  const qrSize = Math.round(layout.qr.w * c.width);
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, code, {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: layout.qr.dark, light: layout.qr.light },
  });
  ctx.drawImage(qr, Math.round(layout.qr.x * c.width - qrSize / 2), Math.round(layout.qr.y * c.height - qrSize / 2), qrSize, qrSize);
  if (layout.code.show) {
    const fs = Math.max(8, Math.round(layout.code.size * c.height));
    ctx.font = `${layout.code.bold ? "700" : "500"} ${fs}px "JetBrains Mono", monospace`;
    ctx.fillStyle = layout.code.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(code, layout.code.x * c.width, layout.code.y * c.height);
  }
  return c;
}

export function canvasJpeg(c: HTMLCanvasElement, q = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", q));
}
