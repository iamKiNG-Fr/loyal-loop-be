import { createHmac, timingSafeEqual } from "node:crypto";

export function receiptMediaSignature(secret: string, receiptId: string, expires: number) {
  return createHmac("sha256", secret).update(`${receiptId}:${expires}`).digest("hex");
}

export function verifyReceiptMediaSignature(secret: string, receiptId: string, expires: number, signature: string) {
  const expected = Buffer.from(receiptMediaSignature(secret, receiptId, expires));
  const received = Buffer.from(signature || "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
