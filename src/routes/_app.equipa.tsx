import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/equipa")({
  head: () => ({
    meta: [
      { title: "Equipa — MACRO YETU TICKETs" },
      { name: "description", content: "Gerir quem tem acesso ao painel e à portaria." },
      { property: "og:title", content: "Equipa — MACRO YETU TICKETs" },
      { property: "og:description", content: "Gerir acessos da equipa." },
    ],
  }),
  component: Team,
});

type Role = "admin" | "staff" | "promoter";
const SUPER = "macroyetu@gmail.com";

function Team() {
  const { session, isAdmin } = useAuth();
  const isSuper = session?.user.email?.toLowerCase() === SUPER;
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      return (profiles ?? []).map((p) => ({ ...p, roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as Role) }));
    },
  });

  const setRole = async (uid: string, role: Role | null) => {
    if (uid === session?.user.id) return toast.error("Não pode alterar o seu próprio acesso.");
    const del = await supabase.from("user_roles").delete().eq("user_id", uid).select();
    if (del.error) return toast.error(del.error.message);
    if (role) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role });
      if (error) return toast.error(role === "admin" ? "Só o administrador principal pode nomear administradores." : error.message);
      if (role === "promoter") await supabase.from("profiles").update({ wants_promoter: false }).eq("id", uid);
    }
    qc.invalidateQueries({ queryKey: ["team"] });
  };

  if (!isAdmin) return <p className="text-muted-foreground">Apenas administradores.</p>;
  const pending = data.filter((p) => p.wants_promoter && !p.roles.includes("promoter"));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Equipa</h1>
        <p className="text-muted-foreground text-sm">
          <b>Portaria</b>: só lê QR e vê os ingressos. <b>Promotor</b>: cria eventos (gratuito) que a administração aprova. <b>Gestão (Admin)</b>: aprova eventos e promotores, gera ingressos extra. Só o administrador principal pode nomear ou retirar membros da gestão.
        </p>
      </div>
      {pending.length > 0 && <p className="rounded-lg bg-primary/10 text-sm p-3"><b>{pending.length}</b> pedido(s) de promotor por aprovar.</p>}
      <div className="rounded-2xl border bg-card divide-y">
        {data.map((p) => {
          const current: Role | null = p.roles.includes("admin") ? "admin" : p.roles.includes("promoter") ? "promoter" : p.roles.includes("staff") ? "staff" : null;
          const targetSuper = p.email?.toLowerCase() === SUPER;
          const lockedRow = p.id === session?.user.id || targetSuper || (current === "admin" && !isSuper);
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold">{p.full_name || p.email}{targetSuper && <span className="ml-2 text-xs text-primary">Administrador principal</span>}</p>
                <p className="text-xs text-muted-foreground">{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
                {p.wants_promoter && current !== "promoter" && <p className="text-xs text-primary font-medium">Pediu para ser promotor</p>}
              </div>
              <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
                {([[null, "Sem acesso"], ["staff", "Portaria"], ["promoter", "Promotor"], ["admin", "Gestão"]] as const).map(([r, l]) => (
                  <Button key={l} size="sm" variant={current === r ? "default" : "ghost"} disabled={lockedRow || (r === "admin" && !isSuper)} onClick={() => setRole(p.id, r)}>{l}</Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
