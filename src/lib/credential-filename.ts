export type CredentialSize = "A6" | "A5" | "A4" | "CUSTOM";
export type ParsedCredentialFilename = {
  eventName: string;
  groupName: string;
  credentialType: string;
  size: CredentialSize;
  widthMm: number;
  heightMm: number;
  quantity: number;
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

const SIZE_MM: Record<Exclude<CredentialSize, "CUSTOM">, [number, number]> = {
  A6: [105, 148],
  A5: [148, 210],
  A4: [210, 297],
};

/**
 * Expected pattern:
 * AF_ CREDENCIAL EVENT NAME - GROUP/TYPE - A6 - 45 F
 * The optional final F/UN marker is ignored; the number is the quantity.
 */
export function parseCredentialFilename(filename: string): ParsedCredentialFilename {
  const base = clean(filename.replace(/\.[a-z0-9]+$/i, ""));
  const parts = base.split(/\s+-\s+/).map(clean).filter(Boolean);
  const header = clean((parts.shift() ?? base).replace(/^AF[_\s-]*/i, "").replace(/^CREDENCIAL\s*/i, ""));
  const groupName = parts.shift() ?? "";
  const sizePart = parts.shift() ?? "A6";
  const sizeMatch = norm(sizePart).match(/\b(A6|A5|A4)\b/);
  const size = (sizeMatch?.[1] ?? "A6") as CredentialSize;
  const quantityPart = parts.join(" ");
  const quantityMatch = quantityPart.match(/(?:^|\D)(\d+)(?:\s*(?:F|UN|UND|UNID|UNIDADES|PCS|X|QTD))?\s*$/i)
    ?? base.match(/(?:^|\D)(\d+)\s*(?:F|UN|UND|UNID|UNIDADES|PCS|X|QTD)?\s*$/i);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  const [widthMm, heightMm] = SIZE_MM[size as Exclude<CredentialSize, "CUSTOM">];
  return {
    eventName: header,
    groupName: groupName || "Sem grupo",
    credentialType: groupName || "Staff",
    size,
    widthMm,
    heightMm,
    quantity: Number.isSafeInteger(quantity) && quantity > 0 ? Math.min(quantity, 10000) : 1,
  };
}
