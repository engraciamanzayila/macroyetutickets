import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { QrCode, ScanLine, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MACRO YETU TICKETs — Ingressos com QR code" },
      { name: "description", content: "Carregue a arte, posicione o QR, gere ingressos únicos e controle a entrada no dia do evento." },
      { property: "og:title", content: "MACRO YETU TICKETs" },
      { property: "og:description", content: "Ingressos com QR code únicos e controlo de entradas para eventos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && session) navigate({ to: "/eventos" });
  }, [loading, session, navigate]);

  return (
    <main className="min-h-screen flex flex-col">
      <header className="container mx-auto px-6 py-6 flex items-center justify-between">
        <Logo />
        <Button asChild variant="secondary"><Link to="/login">Entrar</Link></Button>
      </header>
      <section className="container mx-auto px-6 flex-1 flex flex-col justify-center py-16 max-w-4xl">
        <h1 className="text-5xl md:text-7xl font-extrabold leading-[0.95]">
          Ingressos com <span className="text-brand">QR único</span>, sem complicação.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl">
          Carregue a sua arte, marque onde fica o QR e gere centenas de ingressos prontos a imprimir. No dia, valide cada entrada em segundos.
        </p>
        <div className="mt-10"><Button asChild size="lg" className="shadow-glow"><Link to="/login">Começar agora</Link></Button></div>
        <div className="mt-16 grid sm:grid-cols-3 gap-4">
          {[
            { icon: Upload, t: "Carregue até 100 artes", d: "PDF, JPG, PNG, TIFF — lemos o nome do ficheiro." },
            { icon: QrCode, t: "Posicione o QR", d: "Arraste o QR e o código para o lugar certo." },
            { icon: ScanLine, t: "Controle a entrada", d: "Leitura por câmara, manual e até sem internet." },
          ].map(({ icon: I, t, d }) => (
            <div key={t} className="rounded-xl border bg-card p-5">
              <I className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">{t}</h3>
              <p className="text-sm text-muted-foreground mt-1">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
