import { createServerFn } from "@tanstack/react-start";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function sign(sb: Awaited<ReturnType<typeof admin>>, path: string | null) {
  if (!path) return "";
  const { data } = await sb.storage.from("arts").createSignedUrl(path, 3600);
  return data?.signedUrl ?? "";
}

async function loadShare(token: string) {
  if (!UUID.test(token)) throw new Error("Link inválido");
  const sb = await admin();
  const { data: s } = await sb.from("group_shares").select("*").eq("token", token).maybeSingle();
  if (!s || !s.active) throw new Error("Este link foi desativado ou não existe");
  if (s.expires_at && new Date(s.expires_at) < new Date()) throw new Error("Este link expirou");
  return { sb, s };
}

/** Public: partner portal data for one share link. */
export const getShare = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => ({ token: String(d?.token ?? "") }))
  .handler(async ({ data }) => {
    const { sb, s } = await loadShare(data.token);
    const [{ data: ev }, { data: g }, { data: tk }] = await Promise.all([
      sb.from("events").select("name,event_date,event_time,venue,city").eq("id", s.event_id).single(),
      sb.from("ticket_groups").select("name,ticket_type,layout,art_path,art_width,art_height,width_cm,height_cm").eq("id", s.group_id).single(),
      sb.from("tickets").select("id,code,seq,status,used_at,share_token,holder_name,holder_contact,sent_via,sent_at")
        .eq("share_id", s.id).is("printed_at", null).neq("status", "void").order("seq").limit(2000),
    ]);
    return {
      share: { partner_name: s.partner_name, partner_kind: s.partner_kind, note: s.note, expires_at: s.expires_at },
      event: ev,
      group: g ? { ...g, art_url: await sign(sb, g.art_path), art_path: undefined } : null,
      tickets: tk ?? [],
    };
  });

/** Public: partner records who received tickets and through which channel. */
export const markSent = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; ids: string[]; name?: string; contact?: string; via: string }) => {
    if (!Array.isArray(d?.ids) || !d.ids.length || d.ids.length > 500 || !d.ids.every((i) => UUID.test(i))) throw new Error("Seleção inválida");
    if (!["whatsapp", "email", "link", "download", "edit"].includes(d.via)) throw new Error("Canal inválido");
    return { token: String(d.token), ids: d.ids, via: d.via, name: (d.name ?? "").trim().slice(0, 120), contact: (d.contact ?? "").trim().slice(0, 160) };
  })
  .handler(async ({ data }) => {
    const { sb, s } = await loadShare(data.token);
    const patch: Record<string, unknown> = {};
    if (data.via !== "edit") { patch.sent_via = data.via; patch.sent_at = new Date().toISOString(); }
    if (data.name || data.via === "edit") patch.holder_name = data.name || null;
    if (data.contact || data.via === "edit") patch.holder_contact = data.contact || null;
    const { error } = await sb.from("tickets").update(patch as never).in("id", data.ids).eq("share_id", s.id).is("printed_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Public: ticket holder opens one or more tickets by their private share tokens. */
export const getHolderTickets = createServerFn({ method: "POST" })
  .inputValidator((d: { tokens: string[] }) => {
    const t = (d?.tokens ?? []).filter((x) => UUID.test(x)).slice(0, 50);
    if (!t.length) throw new Error("Link inválido");
    return { tokens: t };
  })
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: tk } = await sb.from("tickets").select("code,seq,status,group_id,event_id,holder_name").in("share_token", data.tokens).neq("status", "void").order("seq");
    if (!tk?.length) throw new Error("Ingresso não encontrado ou anulado");
    const gids = [...new Set(tk.map((t) => t.group_id))];
    const { data: gs } = await sb.from("ticket_groups").select("id,name,ticket_type,layout,art_path,art_width,art_height,width_cm,height_cm").in("id", gids);
    const { data: ev } = await sb.from("events").select("name,event_date,event_time,venue,city").eq("id", tk[0].event_id).single();
    const groups = await Promise.all((gs ?? []).map(async (g) => ({ ...g, art_url: await sign(sb, g.art_path), art_path: undefined })));
    return { event: ev, groups, tickets: tk.map(({ event_id: _e, ...t }) => t) };
  });
