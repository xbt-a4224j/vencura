interface MappedError {
  status: number;
  detail: string;
  code: string; // stable machine-readable error code (error taxonomy)
}

/** Map known chain/viem error messages to a coded, user-facing detail + HTTP status. Null if unrecognized. */
export function mapChainError(err: unknown): MappedError | null {
  const msg = (err as Error)?.message ?? '';
  if (/insufficient funds/i.test(msg))
    return { status: 400, detail: 'Insufficient funds for amount + gas.', code: 'INSUFFICIENT_FUNDS' };
  if (/nonce too low/i.test(msg))
    return { status: 409, detail: 'Nonce too low — a transaction may already be in flight.', code: 'NONCE_TOO_LOW' };
  if (/replacement transaction underpriced/i.test(msg))
    return { status: 409, detail: 'Replacement transaction underpriced.', code: 'REPLACEMENT_UNDERPRICED' };
  if (/(fetch failed|ECONNREFUSED|timed out|HTTP request failed)/i.test(msg))
    return { status: 503, detail: 'Chain RPC unavailable; try again.', code: 'RPC_UNAVAILABLE' };
  return null;
}
