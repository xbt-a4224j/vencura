import type { EncryptedEnvelope } from './aes-256-gcm';

/** A newly generated, encrypted keypair ready to persist on a Wallet row. */
export interface NewKey extends EncryptedEnvelope {
  address: string;
}

/** The one custody abstraction. Swap the implementation
 *  (EncryptedKeySigner → ShamirSigner → MPC) without touching consumers. */
export interface Signer {
  createKey(): Promise<NewKey>;
  getAddress(walletId: string): Promise<string>;
  signMessage(walletId: string, message: string): Promise<string>;
  signTransaction(walletId: string, request: unknown): Promise<string>;
}

/** DI token — `interface` can't be injected by type, so consumers use `@Inject(SIGNER)`. */
export const SIGNER = Symbol('Signer');
