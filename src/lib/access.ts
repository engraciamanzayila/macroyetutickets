export type Role = "admin" | "staff" | "promoter" | "consumer_support" | "promoter_support";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administração",
  promoter: "Promotor",
  staff: "Portaria",
  consumer_support: "Apoio ao público",
  promoter_support: "Apoio a promotores",
};

/** A conta com mais de um perfil entra sempre no painel de maior prioridade. */
export function getPrimaryRole(roles: Role[]): Role | null {
  const priority: Role[] = ["admin", "promoter", "consumer_support", "promoter_support", "staff"];
  return priority.find((role) => roles.includes(role)) ?? null;
}

/** Áreas internas explicitamente autorizadas por painel. Áreas desconhecidas são negadas. */
export const AREA_ROLES: Record<string, Role[]> = {
  "visao-geral": ["admin", "promoter", "consumer_support", "promoter_support"],
  eventos: ["admin", "promoter", "promoter_support"],
  editor: ["promoter"],
  encomendas: ["admin", "promoter", "consumer_support"],
  portaria: ["promoter", "staff"],
  "livre-transito": ["promoter", "staff"],
  equipa: ["admin"],
  identidade: ["admin"],
  zoho: ["admin"],
  "bases-dados": ["admin"],
};

export function canOpen(pathname: string, roles: Role[]): boolean {
  const area = pathname.split("/").filter(Boolean)[0] ?? "";
  const allowed = AREA_ROLES[area];
  if (!allowed) return false;
  const primaryRole = getPrimaryRole(roles);
  return primaryRole !== null && allowed.includes(primaryRole);
}
