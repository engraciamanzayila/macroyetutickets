export type CartItem = {
  eventId: string;
  slug: string;
  groupId: string;
  quantity: number;
};

const CART_KEY = "myt-cart-v1";
const CART_CHANGE_EVENT = "myt-cart-change";

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["eventId"] === "string" &&
    typeof item["slug"] === "string" &&
    typeof item["groupId"] === "string" &&
    Number.isSafeInteger(item["quantity"]) &&
    Number(item["quantity"]) > 0
  );
}

export function readCart(): CartItem[] {
  const raw = localStorage.getItem(CART_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Formato de carrinho inválido.");
    const items = parsed.filter(isCartItem);
    if (items.length !== parsed.length) console.error("O carrinho continha linhas inválidas.");
    return items;
  } catch (error) {
    console.error("Não foi possível ler o carrinho guardado.", error);
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CART_CHANGE_EVENT));
}

export function subscribeToCartChanges(callback: () => void) {
  window.addEventListener(CART_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CART_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
