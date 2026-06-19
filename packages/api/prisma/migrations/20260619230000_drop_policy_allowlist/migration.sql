-- Recipient allowlist removed (gating who can receive is now demonstrated on-chain via ERC-20
-- approve/allowance). Per-tx / daily spending limits remain.
ALTER TABLE "wallet_policies" DROP COLUMN "allowlist";
