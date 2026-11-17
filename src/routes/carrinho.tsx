import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getStoreEvent } from "@/lib/store.functions";
import { readCart, subscribeToCartChanges, writeCart, type CartItem } from "@/lib/cart";
import { DELIVERY_CHANNELS, PAYMENT_METHODS, kz } from "@/lib/payments";
import { supabase } from "@/integrations/supabase/client";
import { StoreHeader } from "@/components/store/StoreHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CheckoutOrder = {
  id: string;
  token: string;
  event_id: string;
  event_name: string;
  total: number;
};

export const Route = createFileRoute("/carrinho")({
  head: () => ({
    meta: [
      { title: "Carrinho — MY Tickets" },
      { name: "description", content: "Reveja os ingressos e finalize as suas encomendas." },
      { property: "og:title", content: "Carrinho — MY Tickets" },
      { property: "og:description", content: "Finalize as suas encomendas de ingressos." },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [delivery, setDelivery] = useState<(typeof DELIVERY_CHANNELS)[number]["id"]>("email");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<CheckoutOrder[]>([]);
  const slugs = useMemo(() => [...new Set(cart.map((item) => item.slug))].sort(), [cart]);

  useEffect(() => {
    const refresh = () => {
      setCart(readCart());
      setCartLoaded(true);
    };
    refresh();
    return subscribeToCartChanges(refresh);
  }, []);

  const {
    data: eventsBySlug = {},
    isLoading,
    error: eventsError,
  } = useQuery({
    queryKey: ["cart-events", slugs],
    enabled: cartLoaded && slugs.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        slugs.map(async (slug) => [slug, await getStoreEvent({ data: { slug } })] as const),
      );
      return Object.fromEntries(entries);
    },
  });

  const resolved = cart.map((item) => {
    const eventData = eventsBySlug[item.slug];
    const group = eventData?.groups.find((candidate) => candidate.id === item.groupId);
    return { item, eventData, group };
  });
  const unavailable = resolved.some(({ eventData, group }) => !eventData || !group);
  const overStock = resolved.some(
    ({ item, group }) => group && item.quantity > Math.min(20, group.available),
  );
  const total = resolved.reduce(
    (sum, { item, group }) => sum + (group ? group.price * item.quantity : 0),
    0,
  );

  const saveCart = (next: CartItem[]) => {
    setCart(next);
    writeCart(next);
  };
  const changeQuantity = (item: CartItem, quantity: number) => {
    const next =
      quantity > 0
        ? cart.map((current) =>
            current.eventId === item.eventId && current.groupId === item.groupId
              ? { ...current, quantity }
              : current,
          )
        : cart.filter(
            (current) => current.eventId !== item.eventId || current.groupId !== item.groupId,
          );
    saveCart(next);
  };

  const checkout = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (unavailable)
      return toast.error("Remove do carrinho os ingressos de eventos ou grupos indisponíveis.");
    if (overStock) return toast.error("Atualiza as quantidades: o stock disponível mudou.");
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_cart_orders", {
        p_items: cart.map((item) => ({
          event_id: item.eventId,
          group_id: item.groupId,
          quantity: item.quantity,
        })),
        p_name: String(form.get("name")),
        p_phone: String(form.get("phone")),
        p_email: String(form.get("email") || ""),
        p_method: String(form.get("method")),
        p_delivery: delivery,
      });
      if (error) throw error;
      const result = data as unknown as { orders: CheckoutOrder[] };
      if (!Array.isArray(result.orders) || result.orders.length === 0) {
        throw new Error("Não foram criadas encomendas para este carrinho.");
      }
      setOrders(result.orders);
      setCart([]);
      try {
        const stored = JSON.parse(localStorage.getItem("myt-orders") || "[]") as unknown;
        const previous = Array.isArray(stored)
          ? stored.filter((token): token is string => typeof token === "string")
          : [];
        localStorage.setItem(
          "myt-orders",
          JSON.stringify([...new Set([...previous, ...result.orders.map((order) => order.token)])]),
        );
        writeCart([]);
        toast.success(`${result.orders.length} encomenda(s) criada(s), uma por evento.`);
      } catch (storageError) {
        console.error(
          "As encomendas foram criadas, mas não foi possível guardar o estado local.",
          storageError,
        );
        toast.warning(
          "Encomendas criadas, mas não foi possível atualizar o carrinho neste dispositivo.",
        );
      }
    } catch (error) {
      toast.error(`Não foi possível finalizar o carrinho: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <StoreHeader />
      <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
        <Link to="/" className="text-sm text-muted-foreground">
          ← Continuar a explorar eventos
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Carrinho</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Um checkout cria uma encomenda separada por evento. Assim, cada promotor mantém o seu
            stock e a sua cobrança.
          </p>
        </div>

        {orders.length > 0 ? (
          <section className="space-y-4 rounded-2xl border bg-card p-5">
            <h2 className="text-xl font-bold">Encomendas criadas</h2>
            <p className="text-sm text-muted-foreground">
              O pagamento é confirmado separadamente para cada evento. Abre cada encomenda para ver
              as instruções.
            </p>
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
              >
                <div>
                  <p className="font-semibold">{order.event_name}</p>
                  <p className="text-sm text-muted-foreground">{kz(order.total)}</p>
                </div>
                <Button asChild>
                  <Link to="/encomenda/$token" params={{ token: order.token }}>
                    Ver encomenda e pagamento
                  </Link>
                </Button>
              </div>
            ))}
          </section>
        ) : !cartLoaded || isLoading ? (
          <p className="text-muted-foreground">A carregar o carrinho…</p>
        ) : eventsError ? (
          <p role="alert" className="text-destructive">
            Não foi possível carregar os eventos do carrinho: {(eventsError as Error).message}
          </p>
        ) : !cart.length ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <p className="text-muted-foreground">O carrinho está vazio.</p>
            <Button asChild className="mt-4">
              <Link to="/">Ver eventos</Link>
            </Button>
          </div>
        ) : (
          <>
            <section className="divide-y rounded-2xl border bg-card px-5">
              {resolved.map(({ item, eventData, group }) => (
                <div
                  key={`${item.eventId}-${item.groupId}`}
                  className="flex flex-wrap items-center gap-4 py-4"
                >
                  <div className="min-w-[180px] flex-1">
                    <p className="font-semibold">
                      {eventData?.event.name ?? "Evento indisponível"}
                    </p>
                    <p className="text-sm">{group?.name ?? "Ingresso indisponível"}</p>
                    {group && (
                      <p className="text-xs text-muted-foreground">
                        {group.ticket_type} · {kz(group.price)}
                      </p>
                    )}
                    {group && item.quantity > Math.min(20, group.available) && (
                      <p className="mt-1 text-xs text-destructive">
                        Disponíveis agora: {Math.min(20, group.available)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="secondary"
                      aria-label="Diminuir quantidade"
                      onClick={() => changeQuantity(item, item.quantity - 1)}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-6 text-center tabular-nums">{item.quantity}</span>
                    <Button
                      size="icon"
                      variant="secondary"
                      aria-label="Aumentar quantidade"
                      disabled={!group || item.quantity >= Math.min(20, group.available)}
                      onClick={() => changeQuantity(item, item.quantity + 1)}
                    >
                      <Plus className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remover do carrinho"
                      onClick={() => changeQuantity(item, 0)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <p className="w-28 text-right font-semibold">
                    {group ? kz(group.price * item.quantity) : "—"}
                  </p>
                </div>
              ))}
              <div className="flex justify-between py-4 text-lg font-bold">
                <span>Total</span>
                <span>{kz(total)}</span>
              </div>
            </section>

            <form onSubmit={checkout} className="space-y-4 rounded-2xl border bg-card p-5">
              <h2 className="text-xl font-bold">Dados para as encomendas</h2>
              <div className="space-y-2">
                <Label htmlFor="cart-buyer-name">Nome completo</Label>
                <Input id="cart-buyer-name" name="name" required minLength={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cart-buyer-phone">Telefone</Label>
                <Input id="cart-buyer-phone" name="phone" type="tel" required minLength={6} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cart-buyer-email">E-mail</Label>
                <Input
                  id="cart-buyer-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required={delivery === "email"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cart-delivery">Canal preferido para receber os ingressos</Label>
                <select
                  id="cart-delivery"
                  value={delivery}
                  onChange={(event) =>
                    setDelivery(event.target.value as (typeof DELIVERY_CHANNELS)[number]["id"])
                  }
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {DELIVERY_CHANNELS.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cart-payment-method">Método de pagamento</Label>
                <select
                  id="cart-payment-method"
                  name="method"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Cada evento gera uma encomenda e uma cobrança própria. O pagamento e o envio dos
                ingressos continuam sujeitos a confirmação manual.
              </p>
              <Button className="w-full" disabled={busy || unavailable || overStock}>
                {busy ? "A criar encomendas…" : `Finalizar carrinho · ${kz(total)}`}
              </Button>
            </form>
          </>
        )}
      </main>
    </>
  );
}
