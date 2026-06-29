import { createHash, randomBytes } from "node:crypto";

export function createOpaqueToken(bytes = 32) {
  const token = randomBytes(bytes).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPrivateValue(value: string, secret = "") {
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

export function createReference(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}
