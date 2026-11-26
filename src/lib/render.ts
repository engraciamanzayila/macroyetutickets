import QRCode from "qrcode";
import { MY_TICKETS_OFFICIAL_LOGO } from "@/assets/my-tickets-official-logo";

export type Layout = {
  qr: { x: number; y: number; w: number; dark: string; light: string };
  code: { x: number; y: number; size: number; color: string; show: boolean; bold: boolean };
};

export const DEFAULT_LAYOUT: Layout = {
  qr: { x: 0.8, y: 0.2, w: 0.14, dark: "#000000", light: "#ffffff" },
  code: { x: 0.87, y: 0.85, size: 0.06, color: "#000000", show: true, bold: true },
};

export const STANDARD_TICKET_LAYOUT: Layout = {
  qr: { x: 0.725, y: 0.22, w: 0.19, dark: "#111827", light: "#ffffff" },
  code: { x: 0.725, y: 0.36, size: 0.018, color: "#111827", show: true, bold: true },
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
  const brandLogo = new Image();
  brandLogo.src = MY_TICKETS_OFFICIAL_LOGO;
  await brandLogo.decode();

  // Clean, light ticket stock. The event artwork is contained in its own
  // reserved panel; it is never stretched across the ticket background.
  ctx.fillStyle = "#f4f6fa";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(28, 28, 844, 1544);
  ctx.strokeStyle = "#d9e0ea";
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, 844, 1544);

  ctx.fillStyle = "#142d59";
  ctx.fillRect(28, 28, 844, 94);
  // Official MY Tickets.ao logo, not a text/icon recreation.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(52, 38, 228, 74, 8);
  ctx.fill();
  ctx.drawImage(brandLogo, 58, 41, 216, 68);
  ctx.textAlign = "right";
  ctx.fillStyle = "#dbe6f7";
  ctx.font = "600 17px sans-serif";
  ctx.fillText("INGRESSO DIGITAL", 836, 84);
  ctx.textAlign = "left";

  // Left panel reserved for the complete official event artwork.
  const artX = 64, artY = 160, artW = 340, artH = 370;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(artX, artY, artW, artH);
  ctx.strokeStyle = "#d7deea";
  ctx.lineWidth = 2;
  ctx.strokeRect(artX, artY, artW, artH);
  if (details.coverUrl) {
    const response = await fetch(details.coverUrl);
    if (!response.ok) throw new Error("Não foi possível carregar a arte oficial do evento.");
    const flyer = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min((artW - 20) / flyer.width, (artH - 20) / flyer.height);
      const width = flyer.width * scale;
      const height = flyer.height * scale;
      ctx.drawImage(flyer, artX + (artW - width) / 2, artY + (artH - height) / 2, width, height);
    } finally {
      flyer.close();
    }
  } else {
    ctx.fillStyle = "#eef2f7";
    ctx.fillRect(artX + 10, artY + 10, artW - 20, artH - 20);
    ctx.fillStyle = "#64748b";
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ARTE DO EVENTO", artX + artW / 2, artY + artH / 2);
    ctx.textAlign = "left";
  }

  // Right panel reserves a white, high-contrast area for the QR and reference.
  const qrX = 450, qrY = 160, qrW = 386, qrH = 370;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(qrX, qrY, qrW, qrH);
  ctx.strokeStyle = "#d7deea";
  ctx.lineWidth = 2;
  ctx.strokeRect(qrX, qrY, qrW, qrH);
  ctx.fillStyle = "#142d59";
  ctx.font = "700 20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("APRESENTE ESTE QR À ENTRADA", qrX + qrW / 2, qrY + 40);
  ctx.fillStyle = "#64748b";
  ctx.font = "500 16px sans-serif";
  ctx.fillText("Código individual de validação", qrX + qrW / 2, qrY + qrH - 24);
  ctx.textAlign = "left";

  ctx.fillStyle = "#142d59";
  ctx.font = "700 22px sans-serif";
  ctx.fillText((details.category || "EVENTO").toUpperCase().slice(0, 48), 64, 640);
  ctx.fillStyle = "#172033";
  ctx.font = "800 54px sans-serif";
  const titleLines = drawWrappedText(ctx, details.eventName, 64, 714, 770, 62, 2);

  let y = 714 + Math.max(1, titleLines) * 62 + 38;
  ctx.fillStyle = "#475569";
  ctx.font = "500 28px sans-serif";
  const date = details.eventDate
    ? new Date(`${details.eventDate}T12:00:00`).toLocaleDateString("pt-AO")
    : null;
  const dateTime = [date, details.eventTime].filter(Boolean).join(" · ");
  if (dateTime) {
    ctx.fillText(dateTime, 64, y);
    y += 54;
  }
  const location = [details.venue, details.city].filter(Boolean).join(" · ");
  if (location) {
    drawWrappedText(ctx, location, 64, y, 760, 38, 2);
    y += 76;
  }

  ctx.fillStyle = "#e8edf4";
  ctx.fillRect(64, 1010, 772, 3);
  ctx.fillStyle = "#64748b";
  ctx.font = "700 22px sans-serif";
  ctx.fillText("TIPO DE INGRESSO", 64, 1080);
  ctx.fillStyle = "#142d59";
  ctx.font = "800 42px sans-serif";
  drawWrappedText(ctx, details.ticketType, 64, 1140, 760, 48, 1);
  ctx.fillStyle = "#334155";
  ctx.font = "600 28px sans-serif";
  drawWrappedText(ctx, details.groupName, 64, 1198, 760, 38, 1);
  if (details.price > 0) {
    ctx.fillStyle = "#142d59";
    ctx.font = "700 30px sans-serif";
    ctx.fillText(`${details.price.toLocaleString("pt-AO")} Kz`, 64, 1260);
  }
  ctx.fillStyle = "#64748b";
  ctx.font = "500 20px sans-serif";
  ctx.fillText("Ingresso pessoal · não partilhe o QR Code", 64, 1518);
  ctx.textAlign = "right";
  ctx.drawImage(brandLogo, 704, 1470, 132, 53);
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
