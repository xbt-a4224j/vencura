// Unifies the activity sources into one newest-first stream: on-chain transactions (sends),
// off-chain signatures (signMessage), and durable governance/audit events (policy changes,
// wallet creation, admin actions). This is the "transaction history (on/off-chain)" requirement
// plus the audit trail — reads merged by time. `walletId` lets a unified, cross-wallet view
// (GET /activity) attribute each row to its wallet.

export interface TxRow {
  id: string;
  status: string;
  asset: string;
  amount: string;
  method?: string | null;
  toAddress: string;
  txHash: string | null;
  walletId?: string;
  createdAt: Date;
}
export interface SigRow {
  id: string;
  message: string;
  signature: string;
  walletId?: string;
  createdAt: Date;
}
// Durable governance events (wallet.created, admin.*) — the audit half of the
// trail, alongside the on-chain (tx) and off-chain (signature) halves.
export interface AuditRow {
  id: string;
  type: string;
  walletId: string | null;
  detail: unknown;
  createdAt: Date;
}
// Inbound transfers indexed from the chain (funds received, not sent by us) — see IncomingWatcher.
export interface ReceivedRow {
  id: string;
  asset: string;
  amount: string;
  fromAddress: string;
  txHash: string;
  walletId?: string;
  createdAt: Date;
}

export type ActivityItem =
  | {
      kind: 'transaction';
      id: string;
      status: string;
      asset: string;
      amount: string;
      method?: string | null;
      to: string;
      txHash: string | null;
      walletId?: string;
      createdAt: Date;
    }
  | { kind: 'signature'; id: string; message: string; signature: string; walletId?: string; createdAt: Date }
  | { kind: 'audit'; id: string; type: string; detail: unknown; walletId: string | null; createdAt: Date }
  | {
      kind: 'received';
      id: string;
      asset: string;
      amount: string;
      from: string;
      txHash: string;
      walletId?: string;
      createdAt: Date;
    };

export function mergeActivity(
  txs: TxRow[],
  sigs: SigRow[],
  audits: AuditRow[] = [],
  received: ReceivedRow[] = [],
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...txs.map((t): ActivityItem => ({
      kind: 'transaction',
      id: t.id,
      status: t.status,
      asset: t.asset,
      amount: t.amount,
      method: t.method,
      to: t.toAddress,
      txHash: t.txHash,
      walletId: t.walletId,
      createdAt: t.createdAt,
    })),
    ...sigs.map((s): ActivityItem => ({
      kind: 'signature',
      id: s.id,
      message: s.message,
      signature: s.signature,
      walletId: s.walletId,
      createdAt: s.createdAt,
    })),
    ...audits.map((a): ActivityItem => ({
      kind: 'audit',
      id: a.id,
      type: a.type,
      detail: a.detail,
      walletId: a.walletId,
      createdAt: a.createdAt,
    })),
    ...received.map((r): ActivityItem => ({
      kind: 'received',
      id: r.id,
      asset: r.asset,
      amount: r.amount,
      from: r.fromAddress,
      txHash: r.txHash,
      walletId: r.walletId,
      createdAt: r.createdAt,
    })),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
