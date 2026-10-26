/** Angola payment methods. Each is confirmed manually until an aggregator (ProxyPay/EMIS/PayPay) is connected. */
export const PAYMENT_METHODS = [
  { id: "multicaixa_express", label: "Multicaixa Express" },
  { id: "referencia", label: "Referência Multicaixa" },
  { id: "unitel_money", label: "Unitel Money" },
  { id: "afrimoney", label: "Afrimoney" },
  { id: "paypay", label: "PayPay" },
  { id: "transferencia", label: "Transferência bancária" },
] as const;

export const DELIVERY_CHANNELS = [
  { id: "email", label: "E-mail" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
] as const;

export const CATEGORIES = [
  "Música",
  "Festa",
  "Teatro",
  "Desporto",
  "Conferência",
  "Festival",
  "Outro",
];

export const methodLabel = (id: string) => PAYMENT_METHODS.find((m) => m.id === id)?.label ?? id;
export const deliveryLabel = (id: string) =>
  DELIVERY_CHANNELS.find((c) => c.id === id)?.label ?? id;
export const kz = (n: number) =>
  new Intl.NumberFormat("pt-AO", { maximumFractionDigits: 0 }).format(n) + " Kz";
export const STATUS_LABEL: Record<string, string> = {
  pending: "Aguarda pagamento",
  paid: "Pago",
  cancelled: "Cancelado",
};
