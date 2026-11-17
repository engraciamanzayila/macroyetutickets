import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarDays, MapPin, Minus, Plus, ShoppingCart, Ticket } from "lucide-react";
import { toast } from "sonner";
import { getStoreEvent } from "@/lib/store.functions";
import { readCart, writeCart } from "@/lib/cart";
import { StoreHeader } from "@/components/store/StoreHeader";
import { Button } from "@/components/ui/button";
import { kz } from "@/lib/payments";
const eventQuery = (slug: string) =>
  queryOptions({
    queryKey: ["store-event", slug],
    queryFn: () => getStoreEvent({ data: { slug } }),
  });
export const Route = createFileRoute("/e/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(eventQuery(params.slug));
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    const title = `${loaderData?.event.name ?? "Evento indisponível"} — MY Tickets`;
    const description =
      loaderData?.event.description?.slice(0, 160) ||
      "Escolha os seus ingressos para este evento em Angola.";
    const image = loaderData?.event.cover_url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(image?.startsWith("https://")
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
      ],
    };
  },
  component: EventShop,
});
function EventShop() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(eventQuery(slug));
  const [qty, setQty] = useState<Record<string, number>>({});
  if (!data) return null;
  const { event, groups } = data;
  const total = groups.reduce((s, g) => s + g.price * (qty[g.id] || 0), 0);
  const count = Object.values(qty).reduce((s, v) => s + v, 0);
  const addToCart = () => {
    const selected = groups.filter((group) => qty[group.id] > 0);
    if (!selected.length) return toast.error("Escolhe pelo menos um ingresso.");
    const next = readCart();
    for (const group of selected) {
      const current = next.find(
        (item) => item.eventId === event.id && item.groupId === group.id,
      )?.quantity ?? 0;
      if (current + qty[group.id] > Math.min(20, group.available)) {
        return toast.error(`Só podes reservar até ${Math.min(20, group.available)} ingresso(s) de ${group.name}.`);
      }
    }
    for (const group of selected) {
      const existing = next.find(
        (item) => item.eventId === event.id && item.groupId === group.id,
      );
      if (existing) existing.quantity += qty[group.id];
      else next.push({ eventId: event.id, slug, groupId: group.id, quantity: qty[group.id] });
    }
    writeCart(next);
    setQty({});
    toast.success("Ingressos adicionados ao carrinho.");
  };
  return (
    <>
      <StoreHeader />
      <main className="mx-auto max-w-7xl px-5 py-8">
        <Link to="/" className="text-sm text-muted-foreground">
          ← Todos os eventos
        </Link>
        <div className="mt-6 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <section>
            {event.cover_url ? (
              <img
                src={event.cover_url}
                alt={event.name}
                width={900}
                height={600}
                className="max-h-[480px] w-full rounded-lg object-cover"
              />
            ) : (
              <div className="grid aspect-[16/9] place-items-center bg-secondary">
                <Ticket className="size-16 text-primary" />
              </div>
            )}
            <p className="mt-6 text-sm text-primary">{event.category}</p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">{event.name}</h1>
            <p className="mt-4 flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="size-4" />
              {event.event_date
                ? new Date(event.event_date + "T12:00:00").toLocaleDateString("pt-AO")
                : "Data a anunciar"}{" "}
              {event.event_time}
            </p>
            <p className="mt-3 flex items-center gap-2 text-muted-foreground">
              <MapPin className="size-4" />
              {[event.venue, event.city].filter(Boolean).join(" · ")}
            </p>
            {event.venue && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([event.venue, event.city, "Angola"].filter(Boolean).join(" "))}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm text-primary"
              >
                Ver localização ↗
              </a>
            )}
            <p className="mt-7 whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {event.description}
            </p>
          </section>
          <section className="min-w-0">
            <h2 className="text-2xl font-bold">Os seus ingressos</h2>
            <div className="mt-5 divide-y border-y">
              {groups.map((g) => (
                    <div
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4"
                    >
                      <div>
                        <h3 className="font-semibold">{g.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {g.ticket_type} ·{" "}
                          {g.available ? `${g.available} disponíveis` : "Esgotado"}
                        </p>
                        <p className="mt-2 font-semibold text-primary">{kz(g.price)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button
                          size="icon"
                          variant="secondary"
                          aria-label={`Retirar ${g.name}`}
                          disabled={!qty[g.id]}
                          onClick={() =>
                            setQty({ ...qty, [g.id]: Math.max(0, (qty[g.id] || 0) - 1) })
                          }
                        >
                          <Minus className="size-4" />
                        </Button>
                        <span className="w-5 text-center tabular-nums">{qty[g.id] || 0}</span>
                        <Button
                          size="icon"
                          variant="secondary"
                          aria-label={`Adicionar ${g.name}`}
                          disabled={(qty[g.id] || 0) >= Math.min(20, g.available)}
                          onClick={() => setQty({ ...qty, [g.id]: (qty[g.id] || 0) + 1 })}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
              ))}
            </div>
            {!groups.length && (
              <p className="mt-4 text-muted-foreground">
                Venda de ingressos ainda não disponível.
              </p>
            )}
            <div className="my-5 flex justify-between text-lg font-bold">
              <span>Total · {count} ingresso(s)</span>
              <span>{kz(total)}</span>
            </div>
            {count > 0 && (
              <div className="space-y-3">
                <Button className="w-full" onClick={addToCart}>
                  <ShoppingCart className="size-4" /> Adicionar ao carrinho
                </Button>
                <p className="text-xs text-muted-foreground">
                  Podes continuar a escolher ingressos noutros eventos antes de finalizar a compra.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
