import { Injectable } from '@nestjs/common';
import { EncryptedKeySigner } from './encrypted-key.signer';
import { ShamirSigner } from './shamir.signer';
import type { Signer } from './signer';

/** Dispatches to the correct Signer implementation by the per-wallet signerScheme column.
 *  Distinct from the global SIGNER token (which picks the env-default at startup). */
@Injectable()
export class SignerRegistry {
  constructor(
    private readonly encrypted: EncryptedKeySigner,
    private readonly shamir: ShamirSigner,
  ) {}

  get(scheme: string): Signer {
    return scheme === 'shamir' ? this.shamir : this.encrypted;
  }
}
