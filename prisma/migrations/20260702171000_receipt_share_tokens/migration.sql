CREATE TABLE "receipt_share_tokens" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "receipt_share_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "receipt_share_tokens_tokenHash_key"
  ON "receipt_share_tokens"("tokenHash");

CREATE INDEX "receipt_share_tokens_receiptId_createdAt_idx"
  ON "receipt_share_tokens"("receiptId", "createdAt");

ALTER TABLE "receipt_share_tokens"
  ADD CONSTRAINT "receipt_share_tokens_receiptId_fkey"
  FOREIGN KEY ("receiptId")
  REFERENCES "receipts"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
