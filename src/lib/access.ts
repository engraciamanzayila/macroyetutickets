export type Role = "admin" | "staff" | "promoter" | "operations_support" | "consumer_support" | "promoter_support";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administração",
  promoter: "Promotor",
  staff: "Portaria",
  operations_support: "Equipa de Operações e Apoio",
  consumer_support: "Equipa de Operações e Apoio",
  promoter_support: "Equipa de Operações e Apoio",
};

/** Normaliza os dois papéis antigos de apoio num único painel, sem alterar os dados existentes. */
export function normalizeRoles(roles: Role[]): Role[] {
  const normalized = roles.filter((role) => role !== "consumer_support" && role !== "promoter_support");
  if (roles.includes("consumer_support") || roles.includes("promoter_support") || roles.includes("operations_support")) {
    normalized.push("operations_support");
  }
  return [...new Set(normalized)];
}

/** Uma conta com vários papéis entra no painel de maior prioridade, sem alternância de identidade. */
export function getPrimaryRole(roles: Role[]): Role | null {
  const normalized = normalizeRoles(roles);
  const priority: Role[] = ["admin", "promoter", "operations_support", "staff"];
  return priority.find((role) => normalized.includes(role)) ?? null;
}

/** Áreas internas explicitamente autorizadas por painel. Áreas desconhecidas são negadas. */
export const AREA_ROLES: Record<string, Role[]> = {
  "visao-geral": ["admin", "promoter", "operations_support"],
  eventos: ["admin", "promoter", "operations_support"],
  editor: ["promoter"],
  encomendas: ["admin", "promoter", "operations_support"],
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
