interface MappedError {
  status: number;
  detail: string;
}

/** Map known chain/viem error messages to a user-facing detail + HTTP status. Returns null if unrecognized. */
export function mapChainError(err: unknown): MappedError | null {
  const msg = (err as Error)?.message ?? '';
  if (/insufficient funds/i.test(msg)) return { status: 400, detail: 'Insufficient funds for amount + gas.' };
  if (/nonce too low/i.test(msg)) return { status: 409, detail: 'Nonce too low — a transaction may already be in flight.' };
  if (/replacement transaction underpriced/i.test(msg)) return { status: 409, detail: 'Replacement transaction underpriced.' };
  if (/(fetch failed|ECONNREFUSED|timed out|HTTP request failed)/i.test(msg)) return { status: 503, detail: 'Chain RPC unavailable; try again.' };
  return null;
}
