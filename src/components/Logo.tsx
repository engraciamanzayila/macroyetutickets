import { Ticket } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-primary-foreground">
        <Ticket className="h-5 w-5" />
      </span>
      {!compact && (
        <span className="font-display font-extrabold tracking-tight leading-none">
          MACRO YETU <span className="text-primary">TICKETs</span>
        </span>
      )}
    </div>
  );
}
