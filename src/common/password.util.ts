import { Algorithm, hash, verify } from "@node-rs/argon2";
import {
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

let dummyPasswordHash: Promise<string> | undefined;

export async function hashPassword(password: string) {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, encoded: string) {
  try {
    if (encoded.startsWith("$argon2id$")) {
      return await verify(encoded, password);
    }
    return await verifyLegacyScrypt(password, encoded);
  } catch {
    return false;
  }
}

/**
 * Performs password work even when an account is absent so login response time
 * does not become a reliable account-enumeration signal.
 */
export async function verifyPasswordOrDummy(
  password: string,
  encoded?: string | null,
) {
  if (encoded) return verifyPassword(password, encoded);
  dummyPasswordHash ??= hashPassword(
    "loyal-loop-nonexistent-account-dummy-password",
  );
  await verifyPassword(password, await dummyPasswordHash);
  return false;
}

export function needsPasswordRehash(encoded: string) {
  if (!encoded.startsWith("$argon2id$")) return true;
  const parameters = encoded.split("$")[3] ?? "";
  const parsed = Object.fromEntries(
    parameters.split(",").map((part) => part.split("=", 2)),
  );
  return (
    Number(parsed.m) < ARGON2_OPTIONS.memoryCost ||
    Number(parsed.t) < ARGON2_OPTIONS.timeCost ||
    Number(parsed.p) < ARGON2_OPTIONS.parallelism
  );
}

async function verifyLegacyScrypt(password: string, encoded: string) {
  const [algorithm, saltHex, keyHex] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !saltHex ||
    !keyHex ||
    !/^[a-f\d]+$/i.test(saltHex) ||
    !/^[a-f\d]+$/i.test(keyHex) ||
    saltHex.length % 2 !== 0 ||
    keyHex.length % 2 !== 0
  ) {
    return false;
  }

  const expected = Buffer.from(keyHex, "hex");
  if (expected.length < 32 || expected.length > 128) return false;
  const actual = (await scrypt(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
  )) as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
