import { describe, expect, it } from "vitest";
import { a4Grid } from "@/lib/print";

describe("A4 print grid", () => {
  it("fits five 21cm-wide tickets per A4 sheet, horizontally", () => {
    const g = a4Grid(210, 55);
    expect(g.rot).toBe(false);
    expect(g.cols * g.rows).toBe(5);
  });
});
