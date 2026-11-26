import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Search, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Props = {
  eventId: string;
  ownerId: string | null;
  createdBy: string | null;
  assignedAt: string | null;
};

export function EventAssignmentPanel({ eventId, ownerId, createdBy, assignedAt }: Props) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["event-assignment-profiles"],
    queryFn: async () => {
      const [{ data: people, error: peopleError }, { data: roles, error: rolesError }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email").order("full_name"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      if (peopleError) throw peopleError;
      if (rolesError) throw rolesError;
      return (people ?? []).map((person) => ({
        ...person,
        roles: (roles ?? []).filter((role) => role.user_id === person.id).map((role) => role.role),
      })).filter((person) => !person.roles.some((role) =>
        ["admin", "staff", "consumer_support", "promoter_support"].includes(role)
      ));
    },
  });

  const { data: owner } = useQuery({
    queryKey: ["event-assigned-promoter", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const [{ data, error }, { data: roles, error: rolesError }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email").eq("id", ownerId!).single(),
        supabase.from("user_roles").select("role").eq("user_id", ownerId!),
      ]);
      if (error) throw error;
      if (rolesError) throw rolesError;
      return { ...data, roles: (roles ?? []).map((item) => item.role) };
    },
  });

  const { data: creator } = useQuery({
    queryKey: ["event-created-by", createdBy],
    enabled: !!createdBy,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,full_name,email").eq("id", createdBy!).single();
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return profiles.filter((person) => !term ||
      (person.full_name ?? "").toLocaleLowerCase().includes(term) ||
      (person.email ?? "").toLocaleLowerCase().includes(term)
    ).slice(0, 12);
  }, [profiles, query]);

  const assign = async () => {
    if (!selectedId) return toast.error("Escolhe primeiro a conta responsável.");
    if (!confirm("Associar esta conta ao evento e activar o perfil de Promotor, se ainda não existir?")) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("assign_event_promoter", { p_event: eventId, p_promoter: selectedId });
      if (error) throw error;
      toast.success("Responsável associado. A conta passa a gerir este evento como Promotor.");
      setSelectedId("");
      setQuery("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["event", eventId] }),
        qc.invalidateQueries({ queryKey: ["event-assigned-promoter"] }),
        qc.invalidateQueries({ queryKey: ["event-assignment-profiles"] }),
        qc.invalidateQueries({ queryKey: ["events"] }),
      ]);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <div>
        <h2 className="text-lg font-bold">Responsável operacional do evento</h2>
        <p className="text-sm text-muted-foreground">
          O Administrador mantém o controlo administrativo da plataforma. A conta associada recebe o perfil de Promotor e passa a gerir este evento, incluindo credenciamento, estacionamento, listas, ingressos e equipa operacional.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Criado por (registo de auditoria)</p>
          <p className="font-medium">{creator?.full_name || creator?.email || createdBy || "—"}</p>
          <p className="text-xs text-muted-foreground">Esta informação não é alterada pela atribuição.</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Promotor responsável actual</p>
          {owner && owner.roles.includes("promoter") && !owner.roles.includes("admin") ? (
            <>
              <p className="font-medium">{owner.full_name || "Promotor"}</p>
              <p className="text-sm text-muted-foreground">{owner.email}</p>
              {assignedAt && <Badge className="mt-2" variant="secondary">Associado em {new Date(assignedAt).toLocaleDateString("pt-PT")}</Badge>}
            </>
          ) : (
            <p className="font-medium text-amber-700">Ainda não associado a um promotor</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="event-promoter-search">Procurar conta já registada na MY Tickets</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="event-promoter-search" className="pl-9" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(""); }} placeholder="Nome ou e-mail da pessoa responsável" />
        </div>
        {isLoading ? <p className="text-sm text-muted-foreground">A carregar contas…</p> : (
          <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {filtered.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Nenhuma conta elegível encontrada. A pessoa deve criar primeiro uma conta na plataforma.</p> :
              filtered.map((person) => (
                <button type="button" key={person.id} onClick={() => setSelectedId(person.id)} className={`flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 ${selectedId === person.id ? "bg-primary/10" : ""}`}>
                  <span className="flex min-w-0 items-center gap-3">
                    <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{person.full_name || "Conta sem nome"}</span><span className="block truncate text-xs text-muted-foreground">{person.email || person.id}</span></span>
                  </span>
                  {selectedId === person.id && <CheckCircle2 className="h-5 w-5 text-primary" />}
                  {person.roles.includes("promoter") && <Badge variant="secondary">Promotor</Badge>}
                </button>
              ))
            }
          </div>
        )}
      </div>

      <Button onClick={() => void assign()} disabled={!selectedId || busy}>
        {busy ? "A associar…" : owner && owner.roles.includes("promoter") && !owner.roles.includes("admin") ? "Alterar responsável antes da aprovação" : "Associar responsável ao evento"}
      </Button>
      <p className="text-xs text-muted-foreground">Contas de Administração, Portaria e Operações e Apoio não podem ser associadas como Promotor. A conta de Administrador que criou o evento mantém-se registada como criadora e continua a ter acesso administrativo.</p>
    </section>
  );
}
