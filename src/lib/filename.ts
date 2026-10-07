export const TICKET_TYPES = ["Normal", "VIP", "VIP em pé", "Mesa", "Convite", "Backstage"] as const;

export type ParsedName = {
  name: string;
  eventName: string;
  recipient: string;
  ticketType: string;
  quantity: number;
  widthCm: number | null;
  heightCm: number | null;
};

const strip = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

function detectType(s: string): string | null {
  const u = strip(s);
  if (/VIP\s*(EM\s*)?PE\b/.test(u)) return "VIP em pé";
  if (/\bMESAS?\b/.test(u)) return "Mesa";
  if (/\bVIP\b/.test(u)) return "VIP";
  if (/\bBACKSTAGE\b/.test(u)) return "Backstage";
  if (/\bCONVITES?\b/.test(u)) return "Convite";
  if (/\bNORMA(L|IS)\b|\bGERAL\b/.test(u)) return "Normal";
  return null;
}

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)?/i;
const QTY_ONLY_RE = /^(\d+)\s*(F|UN|UND|UNID|UNIDADES|PCS|X|QTD|EX)?$/i;

/** Reads event name, recipient, area/type, quantity and size from a file name. */
export function parseFilename(filename: string): ParsedName {
  const base = filename.replace(/\.[a-z0-9]+$/i, "").replace(/\s+/g, " ").trim();
  const segments = base.split(/\s+-\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);

  let quantity = 0;
  let widthCm: number | null = null;
  let heightCm: number | null = null;
  let ticketType: string | null = null;
  const rest: string[] = [];

  for (const seg of segments) {
    let s = seg;
    const size = s.match(SIZE_RE);
    if (size) {
      const k = size[3]?.toLowerCase() === "mm" ? 0.1 : 1;
      widthCm = parseFloat(size[1].replace(",", ".")) * k;
      heightCm = parseFloat(size[2].replace(",", ".")) * k;
      s = s.replace(SIZE_RE, "").trim();
    }
    const q = s.match(QTY_ONLY_RE);
    if (q) {
      quantity = parseInt(q[1], 10);
      continue;
    }
    const qInline = s.match(/(?:QTD|QUANT(?:IDADE)?)\D*(\d+)/i);
    if (qInline) {
      quantity = parseInt(qInline[1], 10);
      s = s.replace(qInline[0], "").trim();
    }
    const t = detectType(s);
    if (t) {
      ticketType = ticketType ?? t;
      const leftover = strip(s)
        .replace(/VIP\s*(EM\s*)?PE|MESAS?|VIP|BACKSTAGE|CONVITES?|NORMA(L|IS)|GERAL|AREA/g, "")
        .trim();
      if (leftover.length < 2) continue;
    }
    if (s) rest.push(s);
  }

  if (!quantity) {
    const m = base.match(/\b(\d+)\s*F\b/i);
    if (m) quantity = parseInt(m[1], 10);
  }

  const clean = (s: string) => s.replace(/\s+AF$/i, "").trim();
  const eventName = rest[0] ? clean(rest[0]) : "";
  const recipient = rest[1] ? clean(rest[1]) : "";
  const type = ticketType ?? "Normal";

  return {
    name: [eventName || base, type].filter(Boolean).join(" · "),
    eventName,
    recipient,
    ticketType: type,
    quantity: quantity || 1,
    widthCm,
    heightCm,
  };
}
