export const LOCK = Symbol('Lock');
export interface Lock {
  /** Run fn while holding an exclusive per-wallet lock; serializes concurrent callers. */
  withWalletLock<T>(walletId: string, fn: () => Promise<T>): Promise<T>;
}
