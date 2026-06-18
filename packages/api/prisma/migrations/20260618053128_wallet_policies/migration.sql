-- CreateTable
CREATE TABLE "wallet_policies" (
    "walletId" TEXT NOT NULL,
    "allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "perTxLimit" TEXT,
    "dailyLimit" TEXT,

    CONSTRAINT "wallet_policies_pkey" PRIMARY KEY ("walletId")
);

-- AddForeignKey
ALTER TABLE "wallet_policies" ADD CONSTRAINT "wallet_policies_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
