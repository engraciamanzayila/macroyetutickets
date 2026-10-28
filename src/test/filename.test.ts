import { describe, expect, it } from "vitest";
import { parseFilename } from "@/lib/filename";

describe("ticket group filename parsing", () => {
  it("reads table quantity and price without assigning any holder name", () => {
    expect(parseFilename("Evento - 10 mesas - 150.000 Kz.pdf")).toMatchObject({
      ticketType: "Mesa",
      quantity: 10,
      price: 150000,
    });
  });

  it("reads an explicitly labelled price and decimal amount", () => {
    expect(parseFilename("Evento - QTD 5 - VIP - VALOR 12,5.png")).toMatchObject({
      ticketType: "VIP",
      quantity: 5,
      price: 12.5,
    });
  });
});
