// Test-env defaults, set once before any spec runs (vitest `setupFiles`). These mirror the
// fail-fast config the real modules read at instantiation (JWT secret, master key, RPC URL),
// so e2e specs that import real feature modules don't each have to set them by hand.
// Set unconditionally so the suite is hermetic regardless of any shell env.
process.env.JWT_SECRET = 'test-secret';
process.env.MASTER_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
process.env.RPC_URL = 'http://localhost:8545';
// Master wallet key (provisioning funds from it) + the fixed token address — both REQUIRED by the
// real modules (fail-fast). Dummy values: no master wallet row exists at this address in tests, so
// fundFromMaster cleanly no-ops; getToken just needs a well-formed address.
process.env.MASTER_WALLET_PRIVKEY = `0x${'1'.repeat(64)}`;
process.env.TOKEN_ADDRESS = `0x${'1'.repeat(40)}`;
