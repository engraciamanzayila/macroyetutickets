export type Role = "admin" | "staff" | "promoter" | "consumer_support" | "promoter_support";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Gestão",
  promoter: "Promotor",
  staff: "Portaria",
  consumer_support: "Apoio ao público",
  promoter_support: "Apoio a promotores",
};

/** Which roles may open each internal workspace area (first path segment). */
export const AREA_ROLES: Record<string, Role[]> = {
  "visao-geral": ["admin", "promoter", "consumer_support", "promoter_support"],
  eventos: ["admin", "promoter", "promoter_support"],
  editor: ["admin", "promoter"],
  encomendas: ["admin", "promoter", "consumer_support"],
  portaria: ["admin", "promoter", "staff"],
  equipa: ["admin"],
  identidade: ["admin"],
  zoho: ["admin"],
};

export function canOpen(pathname: string, roles: Role[]): boolean {
  const area = pathname.split("/").filter(Boolean)[0] ?? "";
  const allowed = AREA_ROLES[area];
  if (!allowed) return roles.length > 0;
  return roles.some((r) => allowed.includes(r));
}
