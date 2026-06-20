-- CreateTable
CREATE TABLE "received_transfers" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL DEFAULT 0,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "received_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_cursor" (
    "name" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chain_cursor_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "received_transfers_walletId_txHash_logIndex_key" ON "received_transfers"("walletId", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "received_transfers_walletId_blockNumber_idx" ON "received_transfers"("walletId", "blockNumber");

-- AddForeignKey
ALTER TABLE "received_transfers" ADD CONSTRAINT "received_transfers_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
