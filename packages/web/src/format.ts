import { formatEther } from 'viem';

/** wei (bigint string) → human ETH string. Falls back to the raw value if unparseable.
 *  Demo ERC-20s are 18-decimal too, so this is used for all assets (see SendForm). */
export function toEth(wei: string | bigint): string {
  try {
    return formatEther(BigInt(wei));
  } catch {
    return String(wei);
  }
}

/** 0x1234…abcd — truncate an address/hash for display (full value stays copyable). */
export function shortHex(v: string): string {
  return v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
}

/** Per-wallet display nickname, stored client-side (there is no nickname API). */
export const nicknames = {
  get: (id: string): string => localStorage.getItem(`vencura.nick.${id}`) ?? '',
  set: (id: string, v: string): void => {
    if (v.trim()) localStorage.setItem(`vencura.nick.${id}`, v.trim());
    else localStorage.removeItem(`vencura.nick.${id}`);
  },
};

/** Label a wallet by its nickname when set, else its short address. */
export function walletLabel(id: string, address: string): string {
  return nicknames.get(id) || shortHex(address);
}
