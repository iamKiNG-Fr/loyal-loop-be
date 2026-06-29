-- Loyal Loop backend alignment: 20260628190300_trust_rewards

-- CreateTable
CREATE TABLE "trust_ledger_entries" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "activityEventId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trust_ledger_entries_activityEventId_key" ON "trust_ledger_entries"("activityEventId");

-- CreateIndex
CREATE INDEX "trust_ledger_entries_businessId_createdAt_idx" ON "trust_ledger_entries"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "trust_ledger_entries" ADD CONSTRAINT "trust_ledger_entries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_ledger_entries" ADD CONSTRAINT "trust_ledger_entries_activityEventId_fkey" FOREIGN KEY ("activityEventId") REFERENCES "activity_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
