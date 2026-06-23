import { Logger, Module } from '@nestjs/common';
import { EncryptedKeySigner } from './encrypted-key.signer';
import { ShamirSigner } from './shamir.signer';
import { SIGNER } from './signer';
import { SignerRegistry } from './signer-registry.service';

// Exposes the Signer behind its DI token so consumers depend on the seam, not the impl.
// SIGNER=shamir selects the 2-of-2 Shamir custody model; SIGNER=encrypted (default) → encrypted-key.
// Swapping custody is a one-line env change with zero caller changes — that's the whole point of
// the Signer seam. An unrecognized value fails fast rather than silently falling back.
// SignerRegistry dispatches by per-wallet signerScheme so each wallet uses the scheme it was created with.
@Module({
  providers: [
    EncryptedKeySigner,
    ShamirSigner,
    SignerRegistry,
    {
      provide: SIGNER,
      inject: [EncryptedKeySigner, ShamirSigner],
      useFactory: (encrypted: EncryptedKeySigner, shamir: ShamirSigner) => {
        const choice = process.env.SIGNER ?? 'encrypted';
        const logger = new Logger('SignerModule');
        switch (choice) {
          case 'encrypted':
            logger.log('custody: EncryptedKeySigner (AES-256-GCM at rest)');
            return encrypted;
          case 'shamir':
            logger.log('custody: ShamirSigner (2-of-2 key split, reconstructed transiently)');
            return shamir;
          default:
            throw new Error(`Unknown SIGNER="${choice}" (expected "encrypted" or "shamir")`);
        }
      },
    },
  ],
  exports: [SIGNER, SignerRegistry],
})
export class SignerModule {}
