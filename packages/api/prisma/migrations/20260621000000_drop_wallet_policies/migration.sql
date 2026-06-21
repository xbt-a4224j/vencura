-- Remove the policy engine: the wallet_policies table is no longer used (T-044, #47).
DROP TABLE IF EXISTS "wallet_policies";
