import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

async function gw(path: string, init: RequestInit = {}) {
  const lk = process.env["LOVABLE_API_KEY"], sk = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lk || !sk) throw new Error("Google Sheets não está ligado");
  const r = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": sk, "Content-Type": "application/json" },
  });
  if (!r.ok) {
    const b = await r.text();
    console.error(`Sheets [${r.status}]: ${b}`);
    throw new Error(`Google Sheets [${r.status}]: ${b.slice(0, 200)}`);
  }
  return r.json();
}

const ST: Record<string, string> = { valid: "Por usar", used: "Entrou", void: "Anulado" };

export const syncEventSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventId: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.eventId ?? "")) throw new Error("evento inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: ev } = await sb.from("events").select("id,name,sheet_id").eq("id", data.eventId).single();
    if (!ev) throw new Error("Sem acesso ao evento");
    const { data: groups } = await sb.from("ticket_groups").select("id,name,ticket_type,recipient").eq("event_id", ev.id).order("created_at");
    const tickets: { code: string; seq: number; status: string; group_id: string; used_at: string | null; printed_at: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await sb.from("tickets").select("code,seq,status,group_id,used_at,printed_at").eq("event_id", ev.id).order("seq").range(from, from + 999);
      if (error) throw new Error(error.message);
      tickets.push(...(rows ?? []));
      if (!rows || rows.length < 1000) break;
    }

    let sheetId = ev.sheet_id;
    if (!sheetId) {
      const created = await gw("/spreadsheets", {
        method: "POST",
        body: JSON.stringify({
          properties: { title: `MY Tickets — ${ev.name}` },
          sheets: [{ properties: { title: "Resumo" } }, { properties: { title: "Ingressos" } }],
        }),
      });
      sheetId = created.spreadsheetId as string;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("events").update({ sheet_id: sheetId }).eq("id", ev.id);
    }

    const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-PT", { timeZone: "Africa/Luanda" }) : "");
    const resumo: (string | number)[][] = [
      ["Evento", ev.name], ["Atualizado", fmt(new Date().toISOString())], [],
      ["Grupo", "Tipo", "Destinatário", "Total", "Impressos", "Digitais", "Entraram", "Impressos que entraram", "Digitais que entraram", "Anulados"],
    ];
    for (const g of groups ?? []) {
      const m = tickets.filter((t) => t.group_id === g.id);
      const p = m.filter((t) => t.printed_at), d = m.filter((t) => !t.printed_at);
      const u = (l: typeof m) => l.filter((t) => t.status === "used").length;
      resumo.push([g.name, g.ticket_type, g.recipient ?? "", m.length, p.length, d.length, u(m), u(p), u(d), m.filter((t) => t.status === "void").length]);
    }
    const gm = new Map((groups ?? []).map((g) => [g.id, g]));
    const lista: (string | number)[][] = [["Código", "Nº", "Grupo", "Tipo", "Destinatário", "Canal", "Estado", "Entrada", "Enviado p/ impressão"]];
    for (const t of tickets) {
      const g = gm.get(t.group_id);
      lista.push([t.code, t.seq, g?.name ?? "", g?.ticket_type ?? "", g?.recipient ?? "", t.printed_at ? "Impresso" : "Digital", ST[t.status] ?? t.status, fmt(t.used_at), fmt(t.printed_at)]);
    }

    await gw(`/spreadsheets/${sheetId}/values:batchClear`, { method: "POST", body: JSON.stringify({ ranges: ["Resumo", "Ingressos"] }) });
    await gw(`/spreadsheets/${sheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: [{ range: "Resumo!A1", values: resumo }, { range: "Ingressos!A1", values: lista }] }),
    });
    return { url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` };
  });
