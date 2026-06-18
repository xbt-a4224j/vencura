import { Module } from '@nestjs/common';
import { EncryptedKeySigner } from './encrypted-key.signer';
import { ShamirSigner } from './shamir.signer';
import { SIGNER } from './signer';

// Exposes the Signer behind its DI token so consumers depend on the seam, not the impl.
// SIGNER=shamir selects the 2-of-2 Shamir custody model; anything else → encrypted-key
// (default). Swapping custody is a one-line env change with zero caller changes — that's
// the whole point of the Signer seam (CLAUDE.md §4).
@Module({
  providers: [
    EncryptedKeySigner,
    ShamirSigner,
    {
      provide: SIGNER,
      inject: [EncryptedKeySigner, ShamirSigner],
      useFactory: (encrypted: EncryptedKeySigner, shamir: ShamirSigner) =>
        process.env.SIGNER === 'shamir' ? shamir : encrypted,
    },
  ],
  exports: [SIGNER],
})
export class SignerModule {}
