const MAP: Record<string, [string, string]> = {
  valid: ["Por usar", "bg-secondary text-secondary-foreground"],
  used: ["Entrou", "bg-success/20 text-success"],
  void: ["Anulado", "bg-destructive/20 text-destructive"],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = MAP[status] ?? [status, "bg-secondary"];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}
