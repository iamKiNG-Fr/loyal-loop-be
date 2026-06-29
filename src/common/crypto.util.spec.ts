import { describe, expect, it } from "vitest";
import { createOpaqueToken, hashToken, slugify } from "./crypto.util";

describe("crypto utilities", () => {
  it("returns only a hash suitable for persistence", () => {
    const generated = createOpaqueToken();
    expect(generated.token).not.toBe(generated.tokenHash);
    expect(hashToken(generated.token)).toBe(generated.tokenHash);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes public slugs", () => {
    expect(slugify("  King's Store & Scents  ")).toBe("kings-store-scents");
  });
});
