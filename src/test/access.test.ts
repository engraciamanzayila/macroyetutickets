import { describe, expect, it } from "vitest";
import { canOpen } from "@/lib/access";

describe("workspace access", () => {
  it("promoters cannot open the admin team page", () => {
    expect(canOpen("/equipa", ["promoter"])).toBe(false);
  });
  it("gate staff only opens the gate", () => {
    expect(canOpen("/portaria", ["staff"])).toBe(true);
    expect(canOpen("/encomendas", ["staff"])).toBe(false);
    expect(canOpen("/eventos", ["staff"])).toBe(false);
  });
  it("consumer support sees sales but not events", () => {
    expect(canOpen("/encomendas", ["consumer_support"])).toBe(true);
    expect(canOpen("/eventos/abc", ["consumer_support"])).toBe(false);
  });
  it("admins open everything", () => {
    expect(canOpen("/zoho", ["admin"])).toBe(true);
  });
});
