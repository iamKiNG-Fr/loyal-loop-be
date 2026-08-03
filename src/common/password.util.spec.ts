import { describe, expect, it } from "vitest";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import {
  hashPassword,
  needsPasswordRehash,
  verifyPassword,
  verifyPasswordOrDummy,
} from "./password.util";

const scrypt = promisify(scryptCallback);

describe("password utilities", () => {
  it("hashes with a unique salt and verifies the original password", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^\$argon2id\$/);
    expect(needsPasswordRehash(first)).toBe(false);
    await expect(
      verifyPassword("correct horse battery staple", first),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
  });

  it("rejects malformed hashes", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
  });

  it("accepts legacy scrypt hashes and marks them for an upgrade", async () => {
    const salt = randomBytes(16);
    const key = (await scrypt("legacy password", salt, 64)) as Buffer;
    const encoded = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;

    await expect(verifyPassword("legacy password", encoded)).resolves.toBe(true);
    expect(needsPasswordRehash(encoded)).toBe(true);
  });

  it("does dummy password work when an account is absent", async () => {
    await expect(verifyPasswordOrDummy("anything", null)).resolves.toBe(false);
  });
});
