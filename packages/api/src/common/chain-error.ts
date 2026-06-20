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
  // An on-chain revert (caught at gas-estimation time, before broadcast) — a contract precondition
  // failed. Specialize on the revert reason when present (this demo token reverts "allowance" /
  // "balance"); otherwise a generic, actionable message still beats a bare 500.
  if (/execution reverted|reverted with reason|VM Exception/i.test(msg)) {
    if (/allowance/i.test(msg))
      return {
        status: 400,
        detail:
          'transferFrom reverted: the holder’s on-chain approval (allowance) is less than the requested amount. The holder must approve at least that amount first.',
        code: 'INSUFFICIENT_ALLOWANCE',
      };
    if (/balance/i.test(msg))
      return {
        status: 400,
        detail: 'Reverted: the token balance is less than the requested amount.',
        code: 'INSUFFICIENT_TOKEN_BALANCE',
      };
    return {
      status: 400,
      detail: 'The transaction would revert on-chain (a contract precondition failed) — check the allowance and balances.',
      code: 'EXECUTION_REVERTED',
    };
  }
  return null;
}
