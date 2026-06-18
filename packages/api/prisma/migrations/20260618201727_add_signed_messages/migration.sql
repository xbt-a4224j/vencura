-- CreateTable
CREATE TABLE "signed_messages" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signed_messages_walletId_idx" ON "signed_messages"("walletId");

-- AddForeignKey
ALTER TABLE "signed_messages" ADD CONSTRAINT "signed_messages_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
