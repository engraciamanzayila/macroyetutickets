import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import mockups from "@/assets/brand-mockups.jpg";

export const Route = createFileRoute("/_app/identidade")({
  head: () => ({
    meta: [
      { title: "Identidade visual — MY Tickets" },
      { name: "description", content: "Conceitos visuais da marca MY Tickets." },
    ],
  }),
  component: BrandIdentity,
});

function BrandIdentity() {
  const { isAdmin } = useAuth();

  if (!isAdmin) return <p className="text-muted-foreground">Apenas administradores.</p>;

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Estúdio da marca
        </p>
        <h1 className="text-3xl font-bold">Identidade visual</h1>
        <p className="text-muted-foreground">
          Uma primeira direção visual para a MY Tickets, aplicada a eventos, equipa e
          materiais promocionais.
        </p>
      </header>

      <figure className="overflow-hidden rounded-lg border bg-neutral-950">
        <img
          src={mockups}
          alt="Conceitos de merchandising MY Tickets: t-shirt, boné, copo, pulseiras, credenciais e ingresso"
          className="block h-auto w-full"
        />
        <figcaption className="border-t border-white/10 px-4 py-3 text-sm text-neutral-300">
          Conceito de aplicações da marca. Imagem de visualização, não pronta para produção.
        </figcaption>
      </figure>

      <section aria-labelledby="applications-title" className="space-y-4">
        <div>
          <h2 id="applications-title" className="text-lg font-semibold">
            Aplicações representadas
          </h2>
          <p className="text-sm text-muted-foreground">
            Materiais para eventos, equipa e divulgação.
          </p>
        </div>
        <ul className="grid gap-x-8 gap-y-3 border-y py-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            "T-shirt e boné da equipa",
            "Pulseiras de acesso e identificação",
            "Credencial e porta-credencial",
            "Copo reutilizável",
            "Cartão e material promocional",
            "Ingresso físico de evento",
          ].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="palette-title" className="space-y-4">
        <div>
          <h2 id="palette-title" className="text-lg font-semibold">
            Paleta de referência
          </h2>
          <p className="text-sm text-muted-foreground">
            Cores observadas neste conceito; ainda não são especificações oficiais de impressão.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            { name: "Preto", value: "#111111" },
            { name: "Amarelo bilhete", value: "#F4B400" },
            { name: "Azul palco", value: "#087E8B" },
          ].map((color) => (
            <li key={color.value} className="flex items-center gap-3 border-b py-3">
              <span
                aria-hidden="true"
                className="h-8 w-8 shrink-0 rounded-sm border"
                style={{ backgroundColor: color.value }}
              />
              <span className="text-sm font-medium">{color.name}</span>
              <code className="ml-auto text-xs text-muted-foreground">{color.value}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
