import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

// ENS names live on Ethereum MAINNET (even though VenCura sends on Sepolia). We resolve the name
// against mainnet to a 0x address, then send Sepolia ETH there — the address is the same 20 bytes.
// Public mainnet RPCs (CORS-enabled, no key) with a fallback for reliability; only used for ENS
// lookups, never for signing/sending.
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: fallback([http('https://ethereum-rpc.publicnode.com'), http('https://eth.llamarpc.com')]),
});

/** Resolve an ENS name (e.g. "vitalik.eth") to its mainnet address, or null if it doesn't resolve. */
export async function resolveEns(name: string): Promise<`0x${string}` | null> {
  try {
    return await mainnetClient.getEnsAddress({ name: normalize(name.trim()) });
  } catch {
    return null;
  }
}

/** A recipient input that looks like an ENS name (has a dot, isn't a 0x address). */
export function looksLikeEns(input: string): boolean {
  const v = input.trim();
  return v.includes('.') && !v.startsWith('0x');
}
