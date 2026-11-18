import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { COMPANY } from "@/lib/company";

const SENDER = "mytickets@macroyetu.com";
const DATA_CENTERS = [
  "com",
  "eu",
  "in",
  "com.au",
  "jp",
  "com.cn",
  "com.sa",
  "com.tr",
  "ca",
  "com.br",
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIG_ID = 1;
type ServerSupabase = SupabaseClient<Database>;
type ZohoCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  dataCenter: string;
  accountId: string;
};
type ZohoAccount = { accountId?: string; primaryEmailAddress?: string; primaryEmail?: string };

async function encryptionKey() {
  const secret =
    process.env["ZOHO_CREDENTIALS_ENCRYPTION_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!secret) throw new Error("A chave de cifragem do servidor não está configurada");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("my-tickets-zoho-config-v1"),
      info: new TextEncoder().encode("zoho-mail-credentials"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

async function decrypt(value: string) {
  const [ivValue, ciphertextValue] = value.split(".");
  if (!ivValue || !ciphertextValue) throw new Error("Configuração Zoho inválida");
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    key,
    fromBase64(ciphertextValue),
  );
  return new TextDecoder().decode(plaintext);
}

async function assertMainAdmin(sb: ServerSupabase, userId: string, email: unknown) {
  if (String(email ?? "").toLowerCase() !== "macroyetu@gmail.com") {
    throw new Error("Apenas o administrador principal pode alterar a ligação Zoho");
  }
  const { data, error } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data)
    throw new Error("Apenas o administrador principal pode alterar a ligação Zoho");
}

async function exchangeSelfClientCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  dataCenter: string;
}) {
  // A Self Client code only exists in the Zoho region where it was created; elsewhere Zoho
  // answers invalid_code/invalid_client without consuming it, so we try every region safely.
  const order = [input.dataCenter, ...DATA_CENTERS.filter((dc) => dc !== input.dataCenter)];
  const seen = new Set<string>();
  for (const dc of order) {
    const response = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "authorization_code",
      }),
    }).catch(() => null);
    if (!response) continue;
    const payload = (await response.json().catch(() => ({}))) as {
      refresh_token?: string;
      access_token?: string;
      error?: string;
    };
    if (payload.access_token && payload.refresh_token) return { ...payload, dataCenter: dc };
    if (payload.access_token && !payload.refresh_token) {
      throw new Error(
        "O Zoho aceitou o code mas não devolveu acesso permanente. Gere um code novo (passo 4) e tente outra vez.",
      );
    }
    const err = payload.error ?? `http_${response.status}`;
    seen.add(err);
    if (err !== "invalid_code" && err !== "invalid_client" && !err.startsWith("http_")) {
      throw new Error(`Zoho não aceitou o pedido: ${err}`);
    }
  }
  if (seen.has("invalid_code")) {
    throw new Error(
      "O code já expirou ou já foi usado. Volte ao passo 4, gere um code NOVO e cole-o aqui logo de seguida (clique só uma vez em Ligar).",
    );
  }
  throw new Error(
    "O Client ID ou o Client Secret não estão corretos. Copie-os de novo no separador Client Secret do Zoho (sem espaços) e gere um code novo.",
  );
}

async function verifySenderAccount(accessToken: string, zone: string) {
  const response = await fetch(`https://mail.zoho.${zone}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: ZohoAccount[] | { accounts?: ZohoAccount[] };
  };
  if (!response.ok) throw new Error(`Não foi possível verificar a conta Zoho (${response.status})`);
  const accounts = Array.isArray(payload.data) ? payload.data : (payload.data?.accounts ?? []);
  const account = accounts.find(
    (item) => (item.primaryEmailAddress ?? item.primaryEmail)?.toLowerCase() === SENDER,
  );
  if (!account?.accountId) throw new Error(`O Self Client não tem acesso à caixa ${SENDER}`);
  return account.accountId;
}

export const getZohoMailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMainAdmin(context.supabase, context.userId, context.claims.email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("zoho_mail_config")
      .select("sender_email,data_center,updated_at")
      .eq("id", CONFIG_ID)
      .maybeSingle();
    return {
      connected: !!data,
      sender: data?.sender_email ?? SENDER,
      dataCenter: data?.data_center ?? null,
      updatedAt: data?.updated_at ?? null,
    };
  });

export const saveZohoSelfClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { code: string; clientId: string; clientSecret: string; dataCenter: string }) => {
      const code = String(input.code ?? "").replace(/\s+/g, "");
      const clientId = String(input.clientId ?? "").replace(/\s+/g, "");
      const clientSecret = String(input.clientSecret ?? "").replace(/\s+/g, "");
      const dataCenter = String(input.dataCenter ?? "com")
        .trim()
        .toLowerCase();
      if (!code || code.length > 2000 || !clientId || !clientSecret) {
        throw new Error("Preencha o code, Client ID e Client Secret");
      }
      if (!DATA_CENTERS.includes(dataCenter)) throw new Error("Região Zoho inválida");
      return { code, clientId, clientSecret, dataCenter };
    },
  )
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId, context.claims.email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = await exchangeSelfClientCode(data);
    const accountId = await verifySenderAccount(token.access_token!, token.dataCenter);
    const credentials: ZohoCredentials = {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      refreshToken: token.refresh_token!,
      dataCenter: token.dataCenter,
      accountId,
    };
    const ciphertext = await encrypt(JSON.stringify(credentials));
    const { error } = await supabaseAdmin.from("zoho_mail_config").upsert({
      id: CONFIG_ID,
      ciphertext,
      sender_email: SENDER,
      data_center: token.dataCenter,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Não foi possível guardar a ligação Zoho no servidor");
    return { connected: true as const, sender: SENDER, dataCenter: token.dataCenter };
  });

function html(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

async function getCredentials() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("zoho_mail_config")
    .select("ciphertext,data_center,sender_email")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) throw new Error("Configure primeiro a conta Zoho na página E-mail Zoho");
  const credentials = JSON.parse(await decrypt(data.ciphertext)) as ZohoCredentials;
  if (data.sender_email.toLowerCase() !== SENDER || credentials.accountId === "") {
    throw new Error("A conta Zoho configurada não corresponde ao remetente MY Tickets");
  }
  return credentials;
}

async function accessToken(credentials: ZohoCredentials) {
  const response = await fetch(`https://accounts.zoho.${credentials.dataCenter}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Zoho OAuth falhou${payload.error ? `: ${payload.error}` : ` (${response.status})`}`,
    );
  }
  return payload.access_token;
}

export const sendTicketEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventId: string; ticketIds: string[]; recipient: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(input?.eventId ?? "")) throw new Error("Evento inválido");
    const ticketIds = [...new Set(input.ticketIds ?? [])];
    if (
      !ticketIds.length ||
      ticketIds.length > 500 ||
      ticketIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
    ) {
      throw new Error("Selecione entre 1 e 500 ingressos válidos");
    }
    const recipient = String(input.recipient ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(recipient)) throw new Error("Indique um e-mail de destino válido");
    return { eventId: input.eventId, ticketIds, recipient };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: claimed, error: claimError } = await sb.rpc("claim_ticket_email_delivery", {
      p_event: data.eventId,
      p_ticket_ids: data.ticketIds,
    });
    if (claimError) throw new Error(claimError.message);
    if (!claimed)
      throw new Error(
        "Um ou mais ingressos já foram distribuídos, impressos ou estão a ser enviados",
      );

    const failTickets = async (message: string) => {
      await sb
        .from("tickets")
        .update({
          email_delivery_status: "failed",
          email_delivery_error: message.slice(0, 500),
          email_delivery_updated_at: new Date().toISOString(),
        })
        .eq("event_id", data.eventId)
        .in("id", data.ticketIds);
    };

    try {
      const credentials = await getCredentials();
      const token = await accessToken(credentials);
      const { data: event, error: eventError } = await sb
        .from("events")
        .select(
          "id,name,owner_id,event_date,event_time,venue,city,ticket_email_cc,ticket_email_extra_cc",
        )
        .eq("id", data.eventId)
        .single();
      if (eventError || !event) throw new Error("Evento não encontrado");

      const { data: tickets, error: ticketsError } = await sb
        .from("tickets")
        .select("id,code,share_token,group_id,holder_name")
        .eq("event_id", data.eventId)
        .in("id", data.ticketIds)
        .order("seq");
      if (ticketsError || !tickets || tickets.length !== data.ticketIds.length)
        throw new Error("Alguns ingressos já não estão disponíveis");
      const groupIds = [...new Set(tickets.map((ticket) => ticket.group_id))];
      const { data: groups, error: groupsError } = await sb
        .from("ticket_groups")
        .select("id,name,ticket_type")
        .in("id", groupIds);
      if (groupsError) throw new Error(groupsError.message);
      const groupMap = new Map((groups ?? []).map((group) => [group.id, group]));

      const promoterResult = event.owner_id
        ? await supabaseAdmin.auth.admin.getUserById(event.owner_id)
        : { data: { user: null }, error: null };
      if (promoterResult.error) throw new Error("Não foi possível obter o e-mail do promotor");
      const promoterEmail = promoterResult.data.user?.email?.trim().toLowerCase();
      const promoterCc = event.ticket_email_cc?.trim().toLowerCase() || promoterEmail;
      const extraCc = (event.ticket_email_extra_cc ?? [])
        .flatMap((email) => email.split(/[;,\s]+/))
        .map((email) => email.trim().toLowerCase())
        .filter((email) => EMAIL_RE.test(email));
      const cc = [
        ...new Set(
          [COMPANY.email, promoterCc, ...extraCc].filter(
            (email): email is string => !!email && EMAIL_RE.test(email),
          ),
        ),
      ].filter((email) => email !== data.recipient);

      const baseUrl = new URL(getRequest().url).origin;
      const holderLinks: string[] = [];
      for (let offset = 0; offset < tickets.length; offset += 50) {
        const batch = tickets.slice(offset, offset + 50);
        const url = `${baseUrl}/i/${batch.map((ticket) => encodeURIComponent(ticket.share_token)).join(",")}`;
        const end = offset + batch.length;
        const label =
          tickets.length > 50 ? `Abrir ingressos ${offset + 1}–${end}` : "Abrir e baixar ingressos";
        holderLinks.push(
          `<p style="margin:14px 0"><a href="${html(url)}" style="display:inline-block;padding:12px 18px;background:#d9b643;color:#111;text-decoration:none;font-weight:bold;border-radius:6px">${label}</a></p>`,
        );
      }
      const counts = new Map<string, { count: number; type: string; name: string }>();
      for (const ticket of tickets) {
        const group = groupMap.get(ticket.group_id);
        const current = counts.get(ticket.group_id) ?? {
          count: 0,
          type: group?.ticket_type ?? "Ingresso",
          name: group?.name ?? event.name,
        };
        current.count++;
        counts.set(ticket.group_id, current);
      }
      const itemRows = [...counts.values()]
        .map(
          (item) =>
            `<tr><td style="padding:10px 12px;border-bottom:1px solid #e8e8e8">${html(String(item.count))} × ${html(item.type)} · ${html(item.name)}</td></tr>`,
        )
        .join("");
      const eventInfo = [event.event_date, event.event_time, event.venue, event.city]
        .filter((value): value is string => !!value)
        .map(html)
        .join(" · ");
      const recipients = [
        ...new Set(
          tickets
            .map((ticket) => ticket.holder_name?.trim())
            .filter((name): name is string => !!name),
        ),
      ];
      const greeting = recipients.length === 1 ? `Olá ${html(recipients[0])},` : "Olá,";
      const subject = `${tickets.length} ingresso(s) para ${event.name} — MY Tickets`;
      const content = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#202124"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><tr><td style="background:#111827;padding:25px 30px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:42px;height:42px;background:#d9b643;border-radius:10px;text-align:center;vertical-align:middle;color:#111827;font-size:23px;font-weight:bold">▣</td><td style="padding-left:12px;color:#fff;font-size:22px;font-weight:800">MY <span style="color:#e5c65c">Tickets</span></td></tr></table><p style="margin:20px 0 0;color:#e5c65c;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Os seus ingressos</p><h1 style="margin:8px 0 0;color:#fff;font-size:25px;line-height:1.25">${html(event.name)}</h1>${eventInfo ? `<p style="margin:9px 0 0;color:#d1d5db;font-size:13px;line-height:1.5">${eventInfo}</p>` : ""}</td></tr><tr><td style="padding:30px"><p style="margin:0 0 15px;font-size:16px">${greeting}</p><p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.7">Os seus ingressos para este evento estão prontos. Utilize os botões abaixo para abrir a página segura e descarregar os ficheiros em PDF.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f0;border:1px solid #eee6c9;border-radius:12px;margin:0 0 22px"><tr><td style="padding:17px 19px"><p style="margin:0;color:#806000;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">Resumo da entrega</p><p style="margin:7px 0 0;color:#222;font-size:15px;font-weight:bold">${tickets.length} ingresso(s)</p><p style="margin:5px 0 0;color:#666;font-size:13px">Acesso digital seguro através da MY Tickets</p></td></tr></table>${holderLinks.join("")}<p style="margin:0;color:#6b7280;font-size:13px;line-height:1.7">Na página que abrir, descarregue os ingressos em PDF. Apresente o QR Code ou a referência de cada ingresso à entrada; cada ingresso permite uma única entrada.</p><hr style="border:0;border-top:1px solid #ececec;margin:25px 0"><p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">Mensagem automática da <strong style="color:#333">MY Tickets</strong>. Em caso de dúvidas, contacte a organização do evento.</p></td></tr></table><p style="margin:16px 0 0;color:#9ca3af;font-size:11px">© MY Tickets</p></td></tr></table></body></html>`;

      await sb
        .from("tickets")
        .update({ email_delivery_to: data.recipient, email_delivery_cc: cc })
        .eq("event_id", data.eventId)
        .in("id", data.ticketIds);
      const response = await fetch(
        `https://mail.zoho.${credentials.dataCenter}/api/accounts/${encodeURIComponent(credentials.accountId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fromAddress: SENDER,
            toAddress: data.recipient,
            ...(cc.length ? { ccAddress: cc.join(",") } : {}),
            subject,
            content,
            mailFormat: "html",
          }),
        },
      );
      if (!response.ok) {
        console.error(
          "Zoho Mail send failed",
          response.status,
          (await response.text()).slice(0, 500),
        );
        throw new Error(`Zoho Mail recusou o envio (${response.status})`);
      }
      const zohoResult = (await response.json().catch(() => null)) as {
        status?: { code?: number; description?: string };
      } | null;
      if (zohoResult?.status?.code && zohoResult.status.code !== 200) {
        throw new Error(
          `Zoho Mail recusou o envio: ${zohoResult.status.description ?? zohoResult.status.code}`,
        );
      }
      const sentAt = new Date().toISOString();
      await sb
        .from("tickets")
        .update({
          email_delivery_status: "sent",
          email_delivery_error: null,
          email_delivery_updated_at: sentAt,
          email_sent_at: sentAt,
          sent_at: sentAt,
          sent_via: "email",
        })
        .eq("event_id", data.eventId)
        .in("id", data.ticketIds);
      return { status: "sent" as const, recipient: data.recipient, cc, count: tickets.length };
    } catch (error) {
      const message = (error as Error).message;
      await failTickets(message);
      throw new Error(message);
    }
  });

/** Sends a branded management invitation to an event partner. */
export const sendPartnerShareEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string; recipient: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Link de parceiro inválido");
    const recipient = String(input?.recipient ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(recipient)) throw new Error("Indique um e-mail válido para o parceiro");
    return { token, recipient };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: share } = await supabaseAdmin
      .from("group_shares")
      .select("id,event_id,group_id,token,active,expires_at,partner_name,partner_kind,created_by")
      .eq("token", data.token)
      .maybeSingle();
    if (!share || share.created_by !== context.userId) {
      throw new Error("Não tem autorização para enviar este convite de parceiro");
    }
    if (!share.active || (share.expires_at && new Date(share.expires_at) < new Date())) {
      throw new Error("Este link de parceiro está desativado ou expirou");
    }
    const [credentials, eventResult, groupResult, countResult] = await Promise.all([
      getCredentials(),
      context.supabase.from("events").select("id,name,event_date,event_time,venue,city").eq("id", share.event_id).single(),
      context.supabase.from("ticket_groups").select("name,ticket_type").eq("id", share.group_id).single(),
      supabaseAdmin.from("tickets").select("id", { count: "exact", head: true }).eq("share_id", share.id).neq("status", "void"),
    ]);
    if (eventResult.error || !eventResult.data) throw new Error("Evento não encontrado");
    if (groupResult.error || !groupResult.data) throw new Error("Grupo de ingressos não encontrado");
    const event = eventResult.data;
    const group = groupResult.data;
    const count = countResult.count ?? 0;
    const baseUrl = new URL(getRequest().url).origin;
    const portalUrl = `${baseUrl}/p/${share.token}`;
    const access = await accessToken(credentials);
    const eventInfo = [event.event_date, event.event_time, event.venue, event.city]
      .filter((value): value is string => !!value)
      .map(html)
      .join(" · ");
    const content = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#202124"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb"><tr><td style="background:#111827;padding:25px 30px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:42px;height:42px;background:#d9b643;border-radius:10px;text-align:center;vertical-align:middle;color:#111827;font-size:23px;font-weight:bold">▣</td><td style="padding-left:12px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-.5px">MY <span style="color:#e5c65c">Tickets</span></td></tr></table><p style="margin:20px 0 0;color:#e5c65c;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Convite de parceiro</p><h1 style="margin:8px 0 0;color:#ffffff;font-size:25px;line-height:1.25">${html(event.name)}</h1>${eventInfo ? `<p style="margin:9px 0 0;color:#d1d5db;font-size:13px;line-height:1.5">${eventInfo}</p>` : ""}</td></tr><tr><td style="padding:30px"><p style="margin:0 0 14px;font-size:16px">Olá <strong>${html(share.partner_name)}</strong>,</p><p style="margin:0 0 18px;color:#4b5563;font-size:15px;line-height:1.7">A organização atribuiu à sua entidade ingressos para este evento. Através do seu portal MY Tickets, poderá consultar os ingressos recebidos, escolher os destinatários e fazer a distribuição.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f0;border:1px solid #eee6c9;border-radius:12px;margin:0 0 22px"><tr><td style="padding:17px 19px"><p style="margin:0 0 6px;color:#806000;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">A sua atribuição</p><p style="margin:0;color:#222;font-size:15px;font-weight:bold">${count} ingresso(s) · ${html(group.ticket_type)}</p><p style="margin:5px 0 0;color:#666;font-size:13px">${html(group.name)} · ${html(share.partner_kind)}</p></td></tr></table><table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 22px"><tr><td align="center" bgcolor="#d9b643" style="border-radius:9px"><a href="${html(portalUrl)}" style="display:inline-block;padding:15px 27px;color:#171717;text-decoration:none;font-size:15px;font-weight:bold">Abrir o meu portal de gestão</a></td></tr></table><h2 style="margin:25px 0 10px;font-size:16px;color:#202124">O que pode fazer no portal?</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:7px 0;color:#4b5563;font-size:14px;line-height:1.5">• Consultar os ingressos atribuídos e acompanhar o estado de cada um.</td></tr><tr><td style="padding:7px 0;color:#4b5563;font-size:14px;line-height:1.5">• Selecionar ingressos e enviar os ficheiros PDF pelo WhatsApp.</td></tr><tr><td style="padding:7px 0;color:#4b5563;font-size:14px;line-height:1.5">• Enviar convites por e-mail ou criar links de download para os destinatários.</td></tr><tr><td style="padding:7px 0;color:#4b5563;font-size:14px;line-height:1.5">• Verificar quantos ingressos já foram enviados e quantos já deram entrada.</td></tr></table><p style="margin:22px 0 0;color:#6b7280;font-size:12px;line-height:1.6">Este acesso é pessoal para a gestão da sua atribuição. Não encaminhe este link a convidados; para eles, utilize as opções de distribuição disponíveis dentro do portal.</p><hr style="border:0;border-top:1px solid #ececec;margin:25px 0"><p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">Mensagem automática da <strong style="color:#333">MY Tickets</strong>. Se não estava à espera deste convite, contacte a organização do evento.</p></td></tr></table><p style="margin:16px 0 0;color:#9ca3af;font-size:11px">© MY Tickets</p></td></tr></table></body></html>`;
    const response = await fetch(
      `https://mail.zoho.${credentials.dataCenter}/api/accounts/${encodeURIComponent(credentials.accountId)}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Zoho-oauthtoken ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAddress: SENDER,
          toAddress: data.recipient,
          subject: `Convite de parceiro — ${event.name} | MY Tickets`,
          content,
          mailFormat: "html",
        }),
      },
    );
    const result = (await response.json().catch(() => null)) as { status?: { code?: number; description?: string } } | null;
    if (!response.ok || (result?.status?.code && result.status.code !== 200)) {
      throw new Error(`Não foi possível enviar o convite por e-mail${result?.status?.description ? `: ${result.status.description}` : ` (Zoho ${response.status})`}`);
    }
    return { status: "sent" as const, recipient: data.recipient, count };
  });

/** A partner emails selected ticket holders a branded message with a download-only link. */
export const sendSharedTicketEmail = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; ticketIds: string[]; recipient: string; recipientName?: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Link de partilha inválido");
    const ticketIds = [...new Set(input.ticketIds ?? [])];
    if (!ticketIds.length || ticketIds.length > 50 || ticketIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      throw new Error("Selecione entre 1 e 50 ingressos válidos");
    }
    const recipient = String(input.recipient ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(recipient)) throw new Error("Indique um e-mail de destino válido");
    return {
      token,
      ticketIds,
      recipient,
      recipientName: String(input.recipientName ?? "").trim().slice(0, 120),
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: share } = await supabaseAdmin
      .from("group_shares")
      .select("id,event_id,group_id,active,expires_at,partner_name")
      .eq("token", data.token)
      .maybeSingle();
    if (!share || !share.active || (share.expires_at && new Date(share.expires_at) < new Date())) {
      throw new Error("Este link foi desativado ou expirou");
    }

    const { data: tickets, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select("id,code,group_id,holder_name,share_token")
      .eq("share_id", share.id)
      .eq("event_id", share.event_id)
      .eq("status", "valid")
      .is("printed_at", null)
      .is("sent_at", null)
      .in("id", data.ticketIds)
      .order("seq");
    if (ticketError) throw new Error(ticketError.message);
    if (!tickets || tickets.length !== data.ticketIds.length || tickets.some((ticket) => !ticket.share_token)) {
      throw new Error("Um ou mais ingressos já foram distribuídos ou não pertencem a este link");
    }

    // Claim only tickets belonging to this partner share. The general event-email RPC
    // intentionally accepts share_id IS NULL, so it must not be used for partner tickets.
    const staleSendingBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: claimedTickets, error: claimError } = await supabaseAdmin
      .from("tickets")
      .update({
        email_delivery_status: "sending",
        email_delivery_error: null,
        email_delivery_updated_at: new Date().toISOString(),
      })
      .eq("share_id", share.id)
      .eq("event_id", share.event_id)
      .in("id", data.ticketIds)
      .eq("status", "valid")
      .is("printed_at", null)
      .is("sent_at", null)
      .or(`email_delivery_status.in.(pending,failed),and(email_delivery_status.eq.sending,email_delivery_updated_at.lt.${staleSendingBefore})`)
      .select("id");
    if (claimError) throw new Error(claimError.message);
    if (!claimedTickets || claimedTickets.length !== data.ticketIds.length) {
      const claimedIds = (claimedTickets ?? []).map((ticket) => ticket.id);
      if (claimedIds.length) {
        await supabaseAdmin
          .from("tickets")
          .update({ email_delivery_status: "pending", email_delivery_error: null })
          .eq("share_id", share.id)
          .in("id", claimedIds)
          .eq("email_delivery_status", "sending");
      }
      throw new Error("Um ou mais ingressos já estão a ser enviados ou foram distribuídos");
    }

    const failTickets = async (message: string) => {
      await supabaseAdmin.from("tickets").update({
        email_delivery_status: "failed",
        email_delivery_error: message.slice(0, 500),
        email_delivery_updated_at: new Date().toISOString(),
      }).eq("share_id", share.id).in("id", data.ticketIds);
    };

    try {
      const [credentials, eventResult, groupResult] = await Promise.all([
        getCredentials(),
        supabaseAdmin.from("events").select("id,name,event_date,event_time,venue,city").eq("id", share.event_id).single(),
        supabaseAdmin.from("ticket_groups").select("name,ticket_type").eq("id", share.group_id).single(),
      ]);
      if (eventResult.error || !eventResult.data) throw new Error("Evento não encontrado");
      if (groupResult.error || !groupResult.data) throw new Error("Grupo de ingressos não encontrado");
      const ev = eventResult.data;
      const group = groupResult.data;
      const baseUrl = new URL(getRequest().url).origin;
      const downloadUrl = `${baseUrl}/i/${tickets.map((ticket) => encodeURIComponent(ticket.share_token!)).join(",")}`;
      const eventInfo = [ev.event_date, ev.event_time, ev.venue, ev.city]
        .filter((value): value is string => !!value)
        .map(html)
        .join(" · ");
      const greeting = data.recipientName ? `Olá <strong>${html(data.recipientName)}</strong>,` : "Olá,";
      const content = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#202124"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><tr><td style="background:#111827;padding:25px 30px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:42px;height:42px;background:#d9b643;border-radius:10px;text-align:center;vertical-align:middle;color:#111827;font-size:23px;font-weight:bold">▣</td><td style="padding-left:12px;color:#fff;font-size:22px;font-weight:800">MY <span style="color:#e5c65c">Tickets</span></td></tr></table><p style="margin:20px 0 0;color:#e5c65c;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Os seus ingressos</p><h1 style="margin:8px 0 0;color:#fff;font-size:25px;line-height:1.25">${html(ev.name)}</h1>${eventInfo ? `<p style="margin:9px 0 0;color:#d1d5db;font-size:13px;line-height:1.5">${eventInfo}</p>` : ""}</td></tr><tr><td style="padding:30px"><p style="margin:0 0 15px;font-size:16px">${greeting}</p><p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.7">Recebeu ${tickets.length} ingresso(s) de ${html(group.ticket_type)} — ${html(group.name)} para este evento. Clique no botão abaixo para abrir a página segura e descarregar os seus ingressos em PDF.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f0;border:1px solid #eee6c9;border-radius:12px;margin:0 0 22px"><tr><td style="padding:17px 19px"><p style="margin:0;color:#806000;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">Resumo da entrega</p><p style="margin:7px 0 0;color:#222;font-size:15px;font-weight:bold">${tickets.length} ingresso(s)</p><p style="margin:5px 0 0;color:#666;font-size:13px">${html(group.name)} · ${html(group.ticket_type)}</p></td></tr></table><table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 20px"><tr><td align="center" bgcolor="#d9b643" style="border-radius:9px"><a href="${html(downloadUrl)}" style="display:inline-block;padding:15px 27px;color:#171717;text-decoration:none;font-size:15px;font-weight:bold">Abrir e descarregar ingressos</a></td></tr></table><p style="margin:0;color:#6b7280;font-size:13px;line-height:1.7">Na página que abrir, toque em <strong>Descarregar ingressos em PDF</strong>. O link dá acesso apenas aos ingressos desta mensagem; não permite entrar no portal de gestão do parceiro.</p><p style="margin:22px 0 0;color:#6b7280;font-size:12px;line-height:1.6">Cada ingresso permite uma única entrada. Apresente o QR Code ou a referência à entrada do evento.</p><hr style="border:0;border-top:1px solid #ececec;margin:25px 0"><p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">Enviado através da <strong style="color:#333">MY Tickets</strong>${share.partner_name ? ` em nome de ${html(share.partner_name)}` : ""}. Em caso de dúvidas, contacte a organização.</p></td></tr></table><p style="margin:16px 0 0;color:#9ca3af;font-size:11px">© MY Tickets</p></td></tr></table></body></html>`;
      const access = await accessToken(credentials);
      const response = await fetch(
        `https://mail.zoho.${credentials.dataCenter}/api/accounts/${encodeURIComponent(credentials.accountId)}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Zoho-oauthtoken ${access}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            fromAddress: SENDER,
            toAddress: data.recipient,
            subject: `${tickets.length} ingresso(s) para ${ev.name} — MY Tickets`,
            content,
            mailFormat: "html",
          }),
        },
      );
      const zohoResult = (await response.json().catch(() => null)) as { status?: { code?: number; description?: string } } | null;
      if (!response.ok || (zohoResult?.status?.code && zohoResult.status.code !== 200)) {
        throw new Error(`Zoho Mail recusou o envio${zohoResult?.status?.description ? `: ${zohoResult.status.description}` : ` (${response.status})`}`);
      }
      const sentAt = new Date().toISOString();
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("tickets")
        .update({
          sent_via: "email",
          sent_at: sentAt,
          holder_name: data.recipientName || null,
          holder_contact: data.recipient,
          email_delivery_to: data.recipient,
          email_delivery_status: "sent",
          email_delivery_error: null,
          email_delivery_updated_at: sentAt,
          email_sent_at: sentAt,
        })
        .eq("share_id", share.id)
        .in("id", data.ticketIds)
        .select("id");
      if (updateError || updated?.length !== data.ticketIds.length) {
        throw new Error("O e-mail foi enviado, mas o estado dos ingressos não pôde ser atualizado. Contacte a organização antes de repetir o envio.");
      }
      return { status: "sent" as const, count: tickets.length, recipient: data.recipient };
    } catch (error) {
      const message = (error as Error).message;
      await failTickets(message);
      throw new Error(message);
    }
  });
