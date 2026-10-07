import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, RotateCcw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Group } from "@/lib/generate";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";

export function TicketsPanel({ eventId, groups }: { eventId: string; groups: Group[] }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["tickets", eventId, q, group, status],
    queryFn: async () => {
      let query = supabase.from("tickets").select("id,code,seq,status,used_at,group_id").eq("event_id", eventId).order("seq").limit(200);
      if (q) query = query.ilike("code", `%${q.trim().toUpperCase()}%`);
      if (group) query = query.eq("group_id", group);
      if (status) query = query.eq("status", status);
      return (await query).data ?? [];
    },
  });
  const gname = (id: string) => groups.find((g) => g.id === id)?.name ?? "";

  const setTicket = async (id: string, patch: { status: string; used_at?: null }) => {
    const { error } = await supabase.from("tickets").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tickets", eventId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar código…" className="pl-9 font-mono" />
        </div>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          <option value="" className="bg-popover">Todos os grupos</option>
          {groups.map((g) => <option key={g.id} value={g.id} className="bg-popover">{g.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          <option value="" className="bg-popover">Todos os estados</option>
          <option value="valid" className="bg-popover">Por usar</option>
          <option value="used" className="bg-popover">Entrou</option>
          <option value="void" className="bg-popover">Anulado</option>
        </select>
      </div>
      <div className="rounded-2xl border bg-card divide-y">
        {isLoading ? <p className="p-6 text-muted-foreground">A carregar…</p> : data.length === 0 ? <p className="p-6 text-muted-foreground">Nenhum ingresso. Gere ingressos no separador “Grupos”.</p> :
          data.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="font-mono font-bold w-44">{t.code}</span>
              <span className="text-sm text-muted-foreground flex-1 truncate">#{t.seq} · {gname(t.group_id)}</span>
              {t.used_at && <span className="text-xs text-muted-foreground">{new Date(t.used_at).toLocaleString("pt-PT")}</span>}
              <StatusBadge status={t.status} />
              {t.status === "void" ? (
                <Button size="sm" variant="ghost" onClick={() => setTicket(t.id, { status: "valid" })}><RotateCcw className="h-4 w-4" /> Reativar</Button>
              ) : (
                <>
                  {t.status === "used" && <Button size="sm" variant="ghost" onClick={() => setTicket(t.id, { status: "valid", used_at: null })}><RotateCcw className="h-4 w-4" /> Repor</Button>}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm(`Anular ${t.code}?`) && setTicket(t.id, { status: "void" })}><Ban className="h-4 w-4" /> Anular</Button>
                </>
              )}
            </div>
          ))}
      </div>
      {data.length === 200 && <p className="text-xs text-muted-foreground">A mostrar os primeiros 200. Use a pesquisa para filtrar.</p>}
    </div>
  );
}
