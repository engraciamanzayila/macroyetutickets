import QRCode from "qrcode";

export type Layout = {
  qr: { x: number; y: number; w: number; dark: string; light: string };
  code: { x: number; y: number; size: number; color: string; show: boolean; bold: boolean };
};

export const DEFAULT_LAYOUT: Layout = {
  qr: { x: 0.8, y: 0.2, w: 0.14, dark: "#000000", light: "#ffffff" },
  code: { x: 0.87, y: 0.85, size: 0.06, color: "#000000", show: true, bold: true },
};

export const STANDARD_TICKET_LAYOUT: Layout = {
  qr: { x: 0.8, y: 0.2, w: 0.16, dark: "#111111", light: "#ffffff" },
  code: { x: 0.78, y: 0.84, size: 0.035, color: "#ffffff", show: true, bold: true },
};

export type StandardTicketDetails = {
  eventName: string;
  eventDate: string | null;
  eventTime: string | null;
  venue: string | null;
  city: string | null;
  category: string | null;
  coverUrl: string | null;
  groupName: string;
  ticketType: string;
  price: number;
};

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines++;
      line = word;
      if (lines === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines < maxLines && line) ctx.fillText(line, x, y + lines * lineHeight);
  return Math.min(lines + (line ? 1 : 0), maxLines);
}

export async function createStandardTicketArt(details: StandardTicketDetails) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1600;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar o modelo do ingresso.");

  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#181818");
  background.addColorStop(1, "#29251d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const flyerHeight = 500;
  if (details.coverUrl) {
    const response = await fetch(details.coverUrl);
    if (!response.ok) throw new Error("Não foi possível carregar a capa do evento para o ingresso.");
    const flyer = await createImageBitmap(await response.blob());
    try {
      const scale = Math.max(canvas.width / flyer.width, flyerHeight / flyer.height);
      const width = flyer.width * scale;
      const height = flyer.height * scale;
      ctx.drawImage(flyer, (canvas.width - width) / 2, (flyerHeight - height) / 2, width, height);
    } finally {
      flyer.close();
    }
    const overlay = ctx.createLinearGradient(0, 0, 0, flyerHeight);
    overlay.addColorStop(0, "rgba(0,0,0,0.42)");
    overlay.addColorStop(0.65, "rgba(0,0,0,0.08)");
    overlay.addColorStop(1, "rgba(24,24,24,0.96)");
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, canvas.width, flyerHeight);
  }

  ctx.fillStyle = "#f4bf4f";
  ctx.fillRect(64, 62, 58, 58);
  ctx.strokeStyle = "#181818";
  ctx.lineWidth = 3;
  ctx.strokeRect(76, 76, 34, 30);
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(99, 77);
  ctx.lineTo(99, 105);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 42px sans-serif";
  ctx.fillText("MY Tickets", 96, 108);

  ctx.fillStyle = "#f4bf4f";
  ctx.font = "700 24px sans-serif";
  ctx.fillText((details.category || "EVENTO").toUpperCase().slice(0, 48), 70, 574);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 58px sans-serif";
  const titleLines = drawWrappedText(ctx, details.eventName, 70, 652, 560, 66, 2);

  let y = 652 + Math.max(1, titleLines) * 66 + 34;
  ctx.fillStyle = "#e9e5dc";
  ctx.font = "500 28px sans-serif";
  const date = details.eventDate
    ? new Date(`${details.eventDate}T12:00:00`).toLocaleDateString("pt-AO")
    : null;
  const dateTime = [date, details.eventTime].filter(Boolean).join(" · ");
  if (dateTime) {
    ctx.fillText(dateTime, 70, y);
    y += 54;
  }
  const location = [details.venue, details.city].filter(Boolean).join(" · ");
  if (location) {
    drawWrappedText(ctx, location, 70, y, 700, 40, 2);
    y += 76;
  }

  ctx.fillStyle = "#f4bf4f";
  ctx.fillRect(70, 1010, 760, 2);
  ctx.fillStyle = "#aaa49a";
  ctx.font = "700 22px sans-serif";
  ctx.fillText("TIPO DE INGRESSO", 70, 1070);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 42px sans-serif";
  drawWrappedText(ctx, details.ticketType, 70, 1130, 700, 50, 1);
  ctx.fillStyle = "#e9e5dc";
  ctx.font = "500 28px sans-serif";
  drawWrappedText(ctx, details.groupName, 70, 1182, 700, 38, 1);
  if (details.price > 0) {
    ctx.fillStyle = "#f4bf4f";
    ctx.font = "700 24px sans-serif";
    ctx.fillText(`${details.price.toLocaleString("pt-AO")} Kz`, 70, 1228);
  }
  ctx.fillStyle = "#aaa49a";
  ctx.font = "500 20px sans-serif";
  ctx.fillText("Apresente o QR code à entrada do evento", 70, 1300);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 20px sans-serif";
  ctx.fillText("MY Tickets", 70, 1570);
  ctx.fillStyle = "#aaa49a";
  ctx.font = "500 16px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Ingresso pessoal · não partilhe o QR", 830, 1570);
  ctx.textAlign = "left";

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível guardar o modelo do ingresso."))), "image/png");
  });
}

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

export async function renderTicket(art: ImageBitmap, layout: Layout, code: string, holderName?: string | null): Promise<HTMLCanvasElement> {
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
  if (holderName?.trim()) {
    const label = holderName.trim().slice(0, 120);
    const fs = Math.max(14, Math.round(c.height * 0.045));
    ctx.font = `700 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const x = c.width / 2, y = c.height * 0.93;
    const width = Math.min(c.width * 0.9, ctx.measureText(label).width + fs * 2);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillRect(x - width / 2, y - fs * 0.8, width, fs * 1.6);
    ctx.fillStyle = "#111111";
    ctx.fillText(label, x, y, width - fs);
  }
  return c;
}

export function canvasJpeg(c: HTMLCanvasElement, q = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", q));
}
