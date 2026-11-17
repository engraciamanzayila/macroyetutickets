import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const assertSuperAdminTicketAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isSuperAdmin, error } = await context.supabase.rpc("is_super_admin", {
      _uid: context.userId,
    });
    if (error) throw new Error(error.message);
    if (!isSuperAdmin) {
      throw new Error("Apenas o superadministrador pode aceder a ingressos já enviados ou impressos");
    }
    return { authorized: true as const };
  });

export const releaseTicketsForRedistribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventId: string; ticketIds: string[] }) => {
    const eventId = String(input?.eventId ?? "");
    const ticketIds = [...new Set(input?.ticketIds ?? [])];
    if (!UUID.test(eventId)) throw new Error("Evento inválido");
    if (
      !ticketIds.length ||
      ticketIds.length > 500 ||
      ticketIds.some((id) => !UUID.test(id))
    ) {
      throw new Error("Selecione entre 1 e 500 ingressos válidos");
    }
    return { eventId, ticketIds };
  })
  .handler(async ({ data, context }) => {
    const { data: isSuperAdmin, error: permissionError } = await context.supabase.rpc(
      "is_super_admin",
      { _uid: context.userId },
    );
    if (permissionError) throw new Error(permissionError.message);
    if (!isSuperAdmin) {
      throw new Error("Apenas o superadministrador pode libertar ingressos enviados ou impressos");
    }

    const { data: releasedCount, error } = await context.supabase.rpc(
      "release_tickets_for_redistribution",
      { p_event: data.eventId, p_ticket_ids: data.ticketIds },
    );
    if (error) throw new Error(error.message);
    if (releasedCount !== data.ticketIds.length) {
      throw new Error("Nem todos os ingressos selecionados puderam ser libertados");
    }
    return { releasedCount };
  });
