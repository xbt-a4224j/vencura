-- The demo token is now a fixed pre-deployed Sepolia contract (TOKEN_ADDRESS env),
-- not a DB singleton. Drop the table.
DROP TABLE IF EXISTS "demo_token";
