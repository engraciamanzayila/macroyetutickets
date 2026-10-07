import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CalendarDays, LogOut, ScanLine, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  const { session, loading, isMember, isAdmin, refreshRoles } = useAuth();
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
          <div className="flex gap-2 justify-center">
            <Button variant="secondary" onClick={() => refreshRoles()}>Verificar novamente</Button>
            <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Sair</Button>
          </div>
        </div>
      </div>
    );

  const nav = [
    ...(isAdmin ? [{ to: "/eventos", label: "Eventos", icon: CalendarDays }] : []),
    { to: "/portaria", label: "Portaria", icon: ScanLine },
    ...(isAdmin ? [{ to: "/equipa", label: "Equipa", icon: Users }] : []),
  ] as const;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-6">
          <Link to="/"><Logo /></Link>
          <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
            {nav.map(({ to, label, icon: I }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary"
                activeProps={{ className: "text-foreground bg-secondary" }}
              >
                <I className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
          <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()} title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
