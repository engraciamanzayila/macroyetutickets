import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

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

function encryptionKey() {
  const secret = process.env["ZOHO_CREDENTIALS_ENCRYPTION_KEY"] ?? "";
  if (!/^[\da-f]{64}$/i.test(secret)) {
    throw new Error(
      "Configure ZOHO_CREDENTIALS_ENCRYPTION_KEY como secret hex de 32 bytes no Lovable",
    );
  }
  return new Uint8Array(secret.match(/.{2}/g)!.map((part) => parseInt(part, 16)));
}

function toBase64(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", encryptionKey(), "AES-GCM", false, ["encrypt"]);
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
  const key = await crypto.subtle.importKey("raw", encryptionKey(), "AES-GCM", false, ["decrypt"]);
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
  const response = await fetch(`https://accounts.zoho.${input.dataCenter}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "authorization_code",
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
  };
  if (!response.ok || !payload.refresh_token || !payload.access_token) {
    throw new Error(
      `Zoho não aceitou o Self Client code${payload.error ? `: ${payload.error}` : ` (${response.status})`}`,
    );
  }
  return payload;
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
      const code = String(input.code ?? "").trim();
      const clientId = String(input.clientId ?? "").trim();
      const clientSecret = String(input.clientSecret ?? "").trim();
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
    const accountId = await verifySenderAccount(token.access_token!, data.dataCenter);
    const credentials: ZohoCredentials = {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      refreshToken: token.refresh_token!,
      dataCenter: data.dataCenter,
      accountId,
    };
    const ciphertext = await encrypt(JSON.stringify(credentials));
    const { error } = await supabaseAdmin.from("zoho_mail_config").upsert({
      id: CONFIG_ID,
      ciphertext,
      sender_email: SENDER,
      data_center: data.dataCenter,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Não foi possível guardar a ligação Zoho no servidor");
    return { connected: true as const, sender: SENDER, dataCenter: data.dataCenter };
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
          [promoterCc, ...extraCc].filter(
            (email): email is string => !!email && EMAIL_RE.test(email),
          ),
        ),
      ].filter((email) => email !== data.recipient);

      const baseUrl = (
        process.env["APP_PUBLIC_URL"] ?? "https://macroyetutickets.lovable.app"
      ).replace(/\/$/, "");
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
      const content = `<!doctype html><html><body style="margin:0;background:#f5f6f7;font-family:Arial,sans-serif;color:#222"><div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="padding:24px;background:#111;color:#fff"><p style="margin:0;font-size:12px;color:#d9b643">MY TICKETS</p><h1 style="margin:10px 0 0;font-size:24px">${html(event.name)}</h1>${eventInfo ? `<p style="margin:8px 0 0;color:#d1d5db">${eventInfo}</p>` : ""}</div><div style="padding:24px"><p>${greeting}</p><p>Seguem ${tickets.length} ingresso(s), com QR e código de referência, disponíveis nos links seguros abaixo.</p><table style="width:100%;border-collapse:collapse">${itemRows}</table>${holderLinks.join("")}<p style="font-size:13px;color:#555">Apresente o QR ou a referência de cada ingresso à entrada. Cada ingresso permite uma única entrada.</p><hr style="border:0;border-top:1px solid #eee;margin:24px 0"><p style="font-size:13px;color:#555">Descubra outros eventos e novas experiências em <a href="${html(baseUrl)}" style="color:#806000">MY Tickets</a>.</p><p style="font-size:12px;color:#888">Mensagem automática da MY Tickets. Em caso de dúvidas, contacte a organização do evento.</p></div></div></body></html>`;

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
