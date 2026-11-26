import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useSuspenseQuery, queryOptions } from '@tanstack/react-query';
import { ArrowUpRight, CalendarDays, MapPin, Search, Ticket, Music2, Sparkles, ShieldCheck, Smartphone, Users, PlayCircle, ChevronRight, Clock3 } from 'lucide-react';
import { listStoreEvents } from '@/lib/store.functions';
import { StoreHeader } from '@/components/store/StoreHeader';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import concert from '@/assets/events-concert.jpg';

const eventsQuery = queryOptions({ queryKey: ['store-events'], queryFn: () => listStoreEvents() });

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(eventsQuery),
  head: () => ({ meta: [
    { title: 'MY Tickets — Os seus eventos têm um novo lugar' },
    { name: 'description', content: 'Brevemente: descubra eventos, compre ingressos e prepare os seus próximos eventos com a MY Tickets. Abertura ao público a 15 de Dezembro de 2026.' },
    { property: 'og:title', content: 'MY Tickets — Os seus eventos têm um novo lugar' },
    { property: 'og:description', content: 'Uma nova plataforma para descobrir eventos e viver grandes experiências em Angola.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }), component: Home });
 
const PUBLIC_STORE_ENABLED = true;

function Home() {
  // A loja pública não depende de sessão nem de perfil interno.
  return PUBLIC_STORE_ENABLED ? <Store /> : <ComingSoon />;
}

const rotatingMessages = [
  { eyebrow: 'DESCUBRA O QUE VEM AÍ', title: 'Os seus eventos têm um novo lugar.', body: 'Uma nova forma de encontrar experiências, pessoas e momentos que merecem ser vividos.' },
  { eyebrow: 'ENCONTRE A SUA PRÓXIMA EXPERIÊNCIA', title: 'Concertos. Festivais. Feiras.', body: 'Da música à cultura, do desporto às grandes celebrações: há sempre algo para descobrir.' },
  { eyebrow: 'A EXPERIÊNCIA COMEÇA AQUI', title: 'Encontre eventos. Compre ingressos.', body: 'Descubra o evento, conheça os detalhes e prepare-se para estar presente.' },
  { eyebrow: 'É PROMOTOR DE EVENTOS?', title: 'O próximo grande evento pode ser seu.', body: 'Conheça a MY Tickets e prepare-se para aproximar os seus eventos do público.' },
  { eyebrow: 'TUDO NUM SÓ LUGAR', title: 'Mais simples para quem organiza. Mais fácil para quem participa.', body: 'Uma plataforma criada para ligar promotores, eventos e pessoas.' },
  { eyebrow: 'ESTAMOS A PREPARAR TUDO', title: 'Angola vai viver os eventos de outra forma.', body: 'Estamos a trabalhar para lhe oferecer uma experiência segura, simples e completa.' },
];

const tutorials = [
  { id: 'discover', label: 'Encontrar eventos', icon: Search, title: 'Encontre algo que queira viver', steps: ['Explore a agenda e descubra eventos por categoria.', 'Consulte a data, o local e os detalhes de cada evento.', 'Escolha a experiência que combina consigo.'] },
  { id: 'buy', label: 'Comprar ingressos', icon: Ticket, title: 'O seu ingresso, em poucos passos', steps: ['Abra a página do evento e consulte os tipos de ingresso.', 'Escolha a quantidade e avance para o pagamento.', 'Depois da confirmação, consulte o seu ingresso digital na sua conta ou através do acesso da encomenda.'] },
  { id: 'promote', label: 'Ser promotor', icon: Users, title: 'Traga os seus eventos para a MY Tickets', steps: ['Crie ou aceda à sua conta.', 'Conheça o espaço dedicado aos promotores e prepare os dados do seu evento.', 'A equipa MY Tickets acompanha a análise e os próximos passos.'] },
] as const;

function ComingSoon() {
  const [activeMessage, setActiveMessage] = useState(0);
  const [activeTutorial, setActiveTutorial] = useState<(typeof tutorials)[number]['id']>('discover');
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const rotation = window.setInterval(() => setActiveMessage((current) => (current + 1) % rotatingMessages.length), 5200);
    return () => window.clearInterval(rotation);
  }, []);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, new Date('2026-12-15T00:00:00+01:00').getTime() - Date.now());
      setCountdown({
        days: Math.floor(remaining / 86400000),
        hours: Math.floor((remaining % 86400000) / 3600000),
        minutes: Math.floor((remaining % 3600000) / 60000),
        seconds: Math.floor((remaining % 60000) / 1000),
      });
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const message = rotatingMessages[activeMessage];
  const tutorial = tutorials.find((item) => item.id === activeTutorial) ?? tutorials[0];

  return (
    <main className="min-h-screen overflow-hidden bg-[#080d19] text-white selection:bg-orange-400/30">
      <style>{`
        @keyframes myt-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-12px) } }
        @keyframes myt-glow { 0%,100% { opacity:.35; transform:scale(.95) } 50% { opacity:.7; transform:scale(1.08) } }
        @keyframes myt-enter { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        .myt-enter { animation: myt-enter .65s cubic-bezier(.2,.7,.2,1) both }
        .myt-orb { animation: myt-glow 7s ease-in-out infinite }
        .myt-float { animation: myt-float 7s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .myt-enter,.myt-orb,.myt-float { animation:none!important } }
      `}</style>
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-8">
        <Link to="/" aria-label="MY Tickets — início" className="inline-flex items-center">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 sm:inline-flex">Promotores: inscrições abertas</span>
          <Button asChild size="sm" className="bg-orange-400 text-slate-950 hover:bg-orange-300"><Link to="/promotores">Sou promotor <ArrowUpRight className="ml-1 size-4" /></Link></Button>
        </div>
      </header>

      <section className="relative isolate">
        <div className="myt-orb pointer-events-none absolute -right-32 top-0 -z-10 size-[28rem] rounded-full bg-orange-500/20 blur-[110px]" />
        <div className="pointer-events-none absolute -left-40 top-52 -z-10 size-[25rem] rounded-full bg-blue-500/15 blur-[110px]" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-12 md:grid-cols-[1.05fr_.95fr] md:px-8 md:pb-24 md:pt-20">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/25 bg-orange-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[.18em] text-orange-200"><Sparkles className="size-3.5" /> Uma nova experiência está a chegar</div>
            <div key={activeMessage} className="myt-enter flex h-[500px] flex-col justify-center overflow-hidden py-8 md:h-[420px]">
              <p className="text-xs font-bold tracking-[.22em] text-orange-300">{message.eyebrow}</p>
              <h1 className="mt-4 max-w-2xl text-5xl font-black leading-[1.04] tracking-tight md:text-7xl">{message.title}</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300 md:text-xl">{message.body}</p>
            </div>
            <div className="mt-3 flex items-center gap-2" aria-label={`Mensagem ${activeMessage + 1} de ${rotatingMessages.length}`}>
              {rotatingMessages.map((item, index) => <button key={item.eyebrow} type="button" aria-label={`Ver mensagem ${index + 1}`} aria-current={activeMessage === index} onClick={() => setActiveMessage(index)} className={`h-1.5 rounded-full transition-all ${activeMessage === index ? 'w-9 bg-orange-400' : 'w-3 bg-white/25 hover:bg-white/50'}`} />)}
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 bg-orange-400 px-6 font-bold text-slate-950 hover:bg-orange-300"><Link to="/promotores">Conhecer a área de promotores <ArrowUpRight className="ml-2 size-4" /></Link></Button>
              <a href="#como-funciona" className="inline-flex h-12 items-center gap-2 rounded-md border border-white/15 px-5 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5">Explorar a plataforma <ChevronRight className="size-4" /></a>
            </div>
            <p className="mt-5 text-xs text-slate-400">myticket.ao <span className="mx-2 text-slate-600">•</span> Feito para viver Angola.</p>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="myt-orb absolute inset-8 rounded-[2.5rem] bg-orange-400/20 blur-3xl" />
            <div className="myt-float relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/80 p-3 shadow-2xl shadow-black/40">
              <div className="relative overflow-hidden rounded-[1.5rem]">
                <img src={concert} alt="Público num concerto, imagem ilustrativa de eventos e experiências" width={1536} height={1024} className="h-[390px] w-full object-cover md:h-[490px]" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#080d19] via-[#080d19]/15 to-transparent" />
                <div className="absolute left-5 top-5 rounded-full border border-white/20 bg-black/35 px-3 py-1.5 text-[10px] font-bold tracking-[.2em] text-white backdrop-blur">ANGOLA · AO VIVO</div>
                <div className="absolute inset-x-5 bottom-5">
                  <p className="text-xs font-bold uppercase tracking-[.2em] text-orange-300">A contagem começou</p>
                  <p className="mt-2 text-3xl font-black md:text-4xl">15 DE DEZEMBRO</p>
                  <p className="mt-1 text-sm text-slate-200">Abertura oficial ao público · 2026</p>
                  <div className="mt-5 grid grid-cols-4 gap-2">
                    {([{ label: 'DIAS', value: countdown.days }, { label: 'HORAS', value: countdown.hours }, { label: 'MIN', value: countdown.minutes }, { label: 'SEG', value: countdown.seconds }]).map((unit) => <div key={unit.label} className="rounded-xl border border-white/15 bg-black/35 px-2 py-3 text-center backdrop-blur"><div className="font-mono text-2xl font-bold tabular-nums">{String(unit.value).padStart(2, '0')}</div><div className="mt-1 text-[9px] font-bold tracking-[.16em] text-slate-300">{unit.label}</div></div>)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-2 pt-4 text-xs text-slate-300"><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-400" /> Estamos a preparar o lançamento</span><span>MY Tickets · 2026</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[.035]">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-9 sm:grid-cols-2 md:grid-cols-4 md:px-8">
          {[
            { icon: CalendarDays, title: 'Festivais e concertos', text: 'Música, cultura e grandes palcos.' },
            { icon: Users, title: 'Conferências e empresas', text: 'Encontros profissionais e corporativos.' },
            { icon: Sparkles, title: 'Feiras e workshops', text: 'Ideias, negócios e aprendizagem.' },
            { icon: Ticket, title: 'Festas e celebrações', text: 'Momentos especiais para partilhar.' },
          ].map(({ icon: Icon, title, text }) => <div key={title} className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-400/10 text-orange-300"><Icon className="size-5" /></span><div><h2 className="font-bold">{title}</h2><p className="mt-1 text-sm text-slate-400">{text}</p></div></div>)}
        </div>
      </section>

      <section id="como-funciona" className="mx-auto max-w-7xl px-5 py-20 md:px-8">
        <div className="max-w-2xl"><p className="text-xs font-bold tracking-[.22em] text-orange-300">ANTES DA ABERTURA</p><h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Conheça a MY Tickets.</h2><p className="mt-4 text-slate-400">Estamos a preparar uma plataforma para aproximar quem procura experiências de quem as cria. Veja como tudo vai funcionar.</p></div>
        <div className="mt-9 grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
          <div className="grid gap-3">
            {tutorials.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTutorial(id)} className={`flex items-center justify-between rounded-2xl border p-5 text-left transition ${activeTutorial === id ? 'border-orange-300/60 bg-orange-300/10' : 'border-white/10 bg-white/[.025] hover:bg-white/[.06]'}`}><span className="flex items-center gap-3"><Icon className={`size-5 ${activeTutorial === id ? 'text-orange-300' : 'text-slate-400'}`} /><span className="font-bold">{label}</span></span><ChevronRight className="size-4 text-slate-500" /></button>)}
          </div>
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[.07] to-white/[.02] p-6 md:p-8">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-orange-300"><PlayCircle className="size-4" /> Guia rápido</div>
            <h3 className="mt-4 text-2xl font-black">{tutorial.title}</h3>
            <ol className="mt-6 space-y-4">{tutorial.steps.map((step, index) => <li key={step} className="flex gap-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-orange-400 text-sm font-black text-slate-950">{index + 1}</span><span className="pt-1 leading-relaxed text-slate-300">{step}</span></li>)}</ol>
            <p className="mt-7 border-t border-white/10 pt-5 text-xs leading-relaxed text-slate-500">Os tutoriais completos, com demonstrações e vídeos, serão disponibilizados progressivamente antes da abertura.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-20 md:px-8">
        <div className="relative overflow-hidden rounded-[2rem] border border-orange-300/20 bg-gradient-to-br from-orange-400/15 via-slate-900 to-blue-500/10 p-7 md:p-12">
          <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
            <div><p className="text-xs font-bold tracking-[.2em] text-orange-300">PARA PROMOTORES</p><h2 className="mt-3 max-w-2xl text-3xl font-black md:text-4xl">Os seus eventos merecem chegar mais longe.</h2><p className="mt-4 max-w-2xl text-slate-300">Conheça a plataforma, prepare-se para publicar os seus eventos e acompanhe as informações para promotores.</p></div>
            <Button asChild size="lg" className="h-12 bg-orange-400 px-6 font-bold text-slate-950 hover:bg-orange-300"><Link to="/promotores">Saber mais e começar <ArrowUpRight className="ml-2 size-4" /></Link></Button>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[.035]">
        <div className="mx-auto grid max-w-7xl gap-7 px-5 py-12 md:grid-cols-3 md:px-8">
          <div className="flex gap-3"><ShieldCheck className="mt-1 size-6 shrink-0 text-orange-300" /><div><h3 className="font-bold">Mais confiança</h3><p className="mt-1 text-sm text-slate-400">Uma experiência pensada para dar clareza em cada etapa.</p></div></div>
          <div className="flex gap-3"><Smartphone className="mt-1 size-6 shrink-0 text-orange-300" /><div><h3 className="font-bold">Acesso simples</h3><p className="mt-1 text-sm text-slate-400">Uma experiência adaptada ao telemóvel e ao computador.</p></div></div>
          <div className="flex gap-3"><Clock3 className="mt-1 size-6 shrink-0 text-orange-300" /><div><h3 className="font-bold">Estamos quase</h3><p className="mt-1 text-sm text-slate-400">Abertura oficial ao público a 15 de Dezembro de 2026.</p></div></div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-slate-400 md:flex-row md:items-center md:justify-between md:px-8">
        <div><p className="font-bold text-white">MY <span className="text-orange-400">Tickets</span></p><p className="mt-1">Os seus eventos têm um novo lugar.</p></div>
        <div className="flex flex-wrap gap-5"><Link to="/promotores" className="hover:text-white">Promotores</Link><Link to="/login" className="hover:text-white">Entrar</Link><span>myticket.ao</span></div>
        <p>© 2026 MY Tickets. Todos os direitos reservados.</p>
      </footer>
    </main>
  );
}

function Store() {
  const { data: events } = useSuspenseQuery(eventsQuery);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todos');
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const categories = ['Todos', 'Música', 'Festa', 'Festival', 'Teatro', 'Desporto', 'Conferência'];
  const filtered = events.filter((e) => (!search || `${e.name} ${e.venue} ${e.city}`.toLowerCase().includes(search.toLowerCase())) && (category === 'Todos' || e.category === category) && (!city || e.city === city) && (!date || e.event_date === date));

  return <div className="min-h-screen"><StoreHeader />
    <section className="store-cover relative isolate overflow-hidden"><img src={concert} alt="Público num concerto junto à costa de Luanda — imagem ilustrativa" width={1536} height={1024} className="absolute inset-0 -z-20 size-full object-cover object-center" /><div className="store-shade absolute inset-0 -z-10" /><div className="mx-auto max-w-7xl px-5 py-12 md:py-16"><p className="mb-5 flex items-center gap-2 text-sm font-semibold text-primary"><span className="h-px w-8 bg-primary" /> ANGOLA, AO VIVO</p><h1 className="max-w-2xl text-4xl font-extrabold leading-tight md:text-6xl">MY<br /><span className="text-primary">Tickets</span></h1><p className="mt-5 max-w-md text-lg text-cover-foreground">Os eventos que quer viver.<br />Os ingressos que o levam até lá.</p><Button className="mt-7" size="lg" onClick={() => document.getElementById('agenda')?.scrollIntoView({ behavior: 'smooth' })}>Encontrar o meu próximo evento <ArrowUpRight className="size-5" /></Button><p className="mt-7 text-xs text-cover-foreground">Música · Cultura · Desporto · Grandes encontros</p></div></section>
    <main id="agenda" className="mx-auto max-w-7xl px-5 py-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-accent-foreground">A SUA PRÓXIMA EXPERIÊNCIA</p><h2 className="mt-2 text-3xl font-bold">Descubra os eventos</h2></div><span className="text-sm text-muted-foreground">{events.length} {events.length === 1 ? 'evento disponível' : 'eventos disponíveis'}</span></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_180px_180px]"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Pesquisar eventos" placeholder="Evento, artista ou local" className="h-11 pl-10" value={search} onChange={(e) => setSearch(e.target.value)} /></div><select aria-label="Cidade" className="h-11 rounded-md border bg-background px-3 text-sm" value={city} onChange={(e) => setCity(e.target.value)}><option value="">Todas as cidades</option>{Array.from(new Set(events.flatMap((e) => e.city ? [e.city] : []))).map((c) => <option key={c}>{c}</option>)}</select><Input type="date" aria-label="Data do evento" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} /></div>
    <div className="mt-4 flex flex-wrap gap-2">{categories.map((c) => <Button size="sm" key={c} variant={category === c ? 'default' : 'ghost'} onClick={() => setCategory(c)}>{c === 'Música' && <Music2 className="size-4" />}{c}</Button>)}</div>
    {filtered.length ? <div className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((e) => e.slug ? <Link key={e.id} to="/e/$slug" params={{ slug: e.slug }} className="group overflow-hidden rounded-lg border bg-card"><div className="aspect-[4/3] overflow-hidden">{e.cover_url ? <img src={e.cover_url} alt={e.name} width={600} height={450} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className="grid size-full place-items-center bg-secondary"><Ticket className="size-16 text-primary" /></div>}</div><div className="p-5"><p className="text-xs font-semibold text-primary">{e.category || 'Evento'}</p><h3 className="mt-2 text-xl font-bold">{e.name}</h3><p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="size-4" />{e.event_date ? new Date(e.event_date + 'T12:00:00').toLocaleDateString('pt-AO') : 'Data a anunciar'}</p><p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="size-4" />{[e.venue, e.city].filter(Boolean).join(' · ') || 'Local a anunciar'}</p><p className="mt-5 flex items-center justify-between border-t pt-4 text-sm font-semibold">Ver ingressos <ArrowUpRight className="size-4" /></p></div></Link> : null)}</div> : <div className="mt-8 border-y py-12 text-center"><Ticket className="mx-auto size-9 text-primary" /><h3 className="mt-4 text-xl font-bold">{events.length ? 'Nenhum evento encontrado' : 'A próxima agenda está a chegar'}</h3><p className="mt-2 text-sm text-muted-foreground">{events.length ? 'Experimente outra cidade, data ou categoria.' : 'Os eventos estarão aqui assim que forem aprovados e publicados.'}</p>{(search || date || city || category !== 'Todos') && <Button variant="ghost" className="mt-4" onClick={() => { setSearch(''); setCity(''); setDate(''); setCategory('Todos'); }}>Limpar filtros</Button>}</div>}
    </main><footer className="border-t bg-secondary/40"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-5 py-7"><p className="text-sm text-muted-foreground">MY Tickets · Feito para viver Angola.</p><Button asChild variant="ghost"><Link to="/promotores">É promotor? Publique o seu evento <ArrowUpRight className="size-4" /></Link></Button></div></footer></div>;
}
