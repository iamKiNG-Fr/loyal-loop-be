-- CreateTable
CREATE TABLE "waitlist" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refCode" TEXT NOT NULL,
    "refBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_refCode_key" ON "waitlist"("refCode");
