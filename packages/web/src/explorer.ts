// Sepolia block-explorer + faucet deep-links for the admin inspector (T-022).
const BASE = 'https://sepolia.etherscan.io';

export const explorerAddress = (address: string) => `${BASE}/address/${address}`;
export const explorerTx = (hash: string) => `${BASE}/tx/${hash}`;

// A public Sepolia faucet for funding demo wallets (the one human step for live sends).
export const FAUCET_URL = 'https://www.alchemy.com/faucets/ethereum-sepolia';
