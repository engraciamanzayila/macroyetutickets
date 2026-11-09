import { describe, expect, it } from "vitest";
import { ticketFileName } from "@/lib/ticket-files";

describe("ticket file names", () => {
  it("includes the event, group, sequence, reference and holder in each format", () => {
    const ticket = { seq: 7, code: "MSA-ABCD-2345", holder_name: "João Silva" };
    expect(ticketFileName("House Music", "Mesa VIP", ticket, "pdf")).toBe(
      "House-Music_Mesa-VIP_n0007_MSA-ABCD-2345_Joao-Silva.pdf",
    );
    expect(ticketFileName("House Music", "Mesa VIP", ticket, "png")).toBe(
      "House-Music_Mesa-VIP_n0007_MSA-ABCD-2345_Joao-Silva.png",
    );
  });

  it("uses safe fallbacks when the holder has no name", () => {
    expect(
      ticketFileName("Evento", "Grupo", { seq: 12, code: "TKT-1234", holder_name: null }, "tiff"),
    ).toBe("Evento_Grupo_n0012_TKT-1234_sem-titular.tiff");
  });

  it("keeps separate references unique even when holders share a name", () => {
    const first = ticketFileName(
      "Noite",
      "Mesa",
      { seq: 1, code: "MSA-AAAA-1111", holder_name: "Ana" },
      "jpeg",
    );
    const second = ticketFileName(
      "Noite",
      "Mesa",
      { seq: 2, code: "MSA-BBBB-2222", holder_name: "Ana" },
      "jpeg",
    );
    expect(first).not.toBe(second);
  });
});
