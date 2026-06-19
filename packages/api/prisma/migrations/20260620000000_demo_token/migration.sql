-- CreateTable: the single deployed demo ERC-20 for the approve/transferFrom demo.
CREATE TABLE "demo_token" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "address" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "demo_token_pkey" PRIMARY KEY ("id")
);
