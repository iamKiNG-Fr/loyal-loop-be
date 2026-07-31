import { describe, expect, it } from "vitest";
import {
  receiptMediaSignature,
  verifyReceiptMediaSignature,
} from "./receipt-media.util";

describe("receipt media signatures", () => {
  it("accepts only the matching receipt, expiry, and secret", () => {
    const signature = receiptMediaSignature("secret-one", "receipt-1", 1_800_000_000);

    expect(
      verifyReceiptMediaSignature(
        "secret-one",
        "receipt-1",
        1_800_000_000,
        signature,
      ),
    ).toBe(true);
    expect(
      verifyReceiptMediaSignature(
        "secret-one",
        "receipt-2",
        1_800_000_000,
        signature,
      ),
    ).toBe(false);
    expect(
      verifyReceiptMediaSignature(
        "secret-one",
        "receipt-1",
        1_800_000_001,
        signature,
      ),
    ).toBe(false);
    expect(
      verifyReceiptMediaSignature(
        "secret-two",
        "receipt-1",
        1_800_000_000,
        signature,
      ),
    ).toBe(false);
  });
});
