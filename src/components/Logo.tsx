import { MY_TICKETS_OFFICIAL_LOGO } from "@/assets/my-tickets-official-logo";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      src={MY_TICKETS_OFFICIAL_LOGO}
      alt="MY Tickets.ao — Bilhetes, Credenciais e Eventos"
      className={compact ? "h-9 w-auto max-w-[92px] object-contain" : "h-12 w-auto max-w-[190px] object-contain"}
    />
  );
}
