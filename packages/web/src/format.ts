import { formatEther } from 'viem';

/** wei (bigint string) → human ETH string, shown to `dp` decimals with trailing zeros trimmed
 *  (so small balances read with real precision, e.g. 0.04877485; the exact wei lives in the
 *  tooltip). Falls back to the raw value if unparseable. Demo ERC-20s are 18-decimal too, so this
 *  is used for all assets (see SendForm). */
export function toEth(wei: string | bigint, dp = 8, minDp = 6): string {
  try {
    const full = formatEther(BigInt(wei));
    const [int, frac = ''] = full.split('.');
    // Pad or trim to [minDp..dp] decimal places, then strip trailing zeros beyond minDp.
    const padded = frac.padEnd(dp, '0').slice(0, dp);
    const trimmed = padded.slice(0, minDp) + padded.slice(minDp).replace(/0+$/, '');
    return `${int}.${trimmed}`;
  } catch {
    return String(wei);
  }
}

/** Activity amount for display: ETH dust (< 1e-6 ETH) reads as wei so a 1-wei send doesn't look
 *  like an empty "0 ETH"; tokens and normal ETH amounts format to decimals. */
export function activityAmount(amount: string, asset: string): string {
  if (asset !== 'ETH') return `${toEth(amount)} tokens`;
  const v = BigInt(amount);
  if (v > 0n && v < 1_000_000_000_000n) return `${v} wei`; // < 1e-6 ETH → show exact wei
  return `${toEth(amount)} ETH`;
}

/** 0x1234…abcd — truncate an address/hash for display (full value stays copyable). */
export function shortHex(v: string): string {
  return v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
}
