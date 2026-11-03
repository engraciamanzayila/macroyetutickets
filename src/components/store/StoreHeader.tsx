import { Link } from '@tanstack/react-router';
import { Ticket, UserRound } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
export function StoreHeader() {
  const { session, isMember } = useAuth();
  return <header className="border-b bg-background"><div className="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3"><Link to="/" aria-label="MY Tickets — início"><Logo /></Link><nav className="flex flex-wrap items-center gap-2"><Button asChild variant="ghost" size="sm"><Link to="/meus-ingressos"><Ticket className="size-4"/><span className="hidden sm:inline">Os meus ingressos</span></Link></Button>{isMember && <Button asChild variant="secondary" size="sm"><Link to="/eventos">Meu espaço</Link></Button>}<Button asChild variant="ghost" size="sm"><Link to={session ? '/meus-ingressos' : '/login'}><UserRound className="size-4"/>{session ? 'Conta' : 'Entrar'}</Link></Button></nav></div></header>;
}
