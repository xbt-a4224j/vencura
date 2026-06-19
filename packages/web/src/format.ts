import { formatEther } from 'viem';

/** wei (bigint string) → human ETH string, shown to `dp` decimals with trailing zeros trimmed
 *  (so small balances read with real precision, e.g. 0.04877485; the exact wei lives in the
 *  tooltip). Falls back to the raw value if unparseable. Demo ERC-20s are 18-decimal too, so this
 *  is used for all assets (see SendForm). */
export function toEth(wei: string | bigint, dp = 8): string {
  try {
    const full = formatEther(BigInt(wei));
    // Trim to dp decimals without scientific notation, then drop trailing zeros.
    const [int, frac = ''] = full.split('.');
    if (!frac) return int;
    const trimmed = frac.slice(0, dp).replace(/0+$/, '');
    return trimmed ? `${int}.${trimmed}` : int;
  } catch {
    return String(wei);
  }
}

/** 0x1234…abcd — truncate an address/hash for display (full value stays copyable). */
export function shortHex(v: string): string {
  return v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
}
