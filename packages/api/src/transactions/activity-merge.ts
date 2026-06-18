// Unifies the two activity sources into one newest-first stream: on-chain
// transactions (sends) + off-chain signatures (signMessage). This is the literal
// "transaction history (on/off-chain)" requirement — two reads, merged by time.

export interface TxRow {
  id: string;
  status: string;
  asset: string;
  amount: string;
  toAddress: string;
  txHash: string | null;
  createdAt: Date;
}
export interface SigRow {
  id: string;
  message: string;
  signature: string;
  createdAt: Date;
}

export type ActivityItem =
  | { kind: 'transaction'; id: string; status: string; asset: string; amount: string; to: string; txHash: string | null; createdAt: Date }
  | { kind: 'signature'; id: string; message: string; signature: string; createdAt: Date };

export function mergeActivity(txs: TxRow[], sigs: SigRow[]): ActivityItem[] {
  const items: ActivityItem[] = [
    ...txs.map((t): ActivityItem => ({
      kind: 'transaction',
      id: t.id,
      status: t.status,
      asset: t.asset,
      amount: t.amount,
      to: t.toAddress,
      txHash: t.txHash,
      createdAt: t.createdAt,
    })),
    ...sigs.map((s): ActivityItem => ({
      kind: 'signature',
      id: s.id,
      message: s.message,
      signature: s.signature,
      createdAt: s.createdAt,
    })),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
