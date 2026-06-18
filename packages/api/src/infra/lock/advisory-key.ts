import { createHash } from 'node:crypto';

/** Stable 60-bit positive bigint from a wallet id, for pg_advisory_xact_lock (signed 64-bit). */
export function advisoryKey(walletId: string): bigint {
  const hex = createHash('sha256').update(walletId).digest('hex').slice(0, 15);
  return BigInt('0x' + hex);
}
