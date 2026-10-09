import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CalendarDays, LogOut, Receipt, ScanLine, Store, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  const { session, loading, isMember, isAdmin, isManager, refreshRoles } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading || !session) return <div className="min-h-screen grid place-items-center text-muted-foreground">A carregar…</div>;

  if (!isMember)
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-sm text-center space-y-4">
          <Logo />
          <h1 className="text-2xl font-bold">Aguardando acesso</h1>
          <p className="text-muted-foreground text-sm">
            Peça ao administrador para lhe dar acesso com o e-mail <b>{session.user.email}</b>.
          </p>
          <Button className="w-full" onClick={async () => { const { error } = await supabase.from("profiles").update({ wants_promoter: true }).eq("id", session.user.id); if (error) toast.error(error.message); else toast.success("Pedido enviado. O administrador vai analisar."); }}>Quero vender ingressos (promotor)</Button>
          <div className="flex gap-2 justify-center">
            <Button variant="secondary" onClick={() => refreshRoles()}>Verificar novamente</Button>
            <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Sair</Button>
          </div>
        </div>
      </div>
    );

  const nav = [
    ...(isManager ? [{ to: "/eventos", label: "Eventos", icon: CalendarDays }, { to: "/encomendas", label: "Vendas", icon: Receipt }] : []),
    { to: "/portaria", label: "Portaria", icon: ScanLine },
    ...(isAdmin ? [{ to: "/equipa", label: "Equipa", icon: Users }] : []),
  ] as const;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-6">
          <Link to="/"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {nav.map(({ to, label, icon: I }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary"
                activeProps={{ className: "text-foreground bg-secondary" }}
              >
                <I className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="flex-1 md:hidden" />
          <Button asChild variant="ghost" size="icon" title="Loja"><Link to="/"><Store className="h-4 w-4" /></Link></Button>
          <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()} title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8 pb-24 md:pb-8">
        <Outlet />
      </main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur grid" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
        {nav.map(({ to, label, icon: I }) => (
          <Link key={to} to={to} className="flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground" activeProps={{ className: "text-primary" }}>
            <I className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
