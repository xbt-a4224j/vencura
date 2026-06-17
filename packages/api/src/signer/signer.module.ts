import { Module } from '@nestjs/common';
import { EncryptedKeySigner } from './encrypted-key.signer';
import { SIGNER } from './signer';

// Exposes the Signer behind its DI token so consumers depend on the seam, not the impl.
@Module({
  providers: [{ provide: SIGNER, useClass: EncryptedKeySigner }],
  exports: [SIGNER],
})
export class SignerModule {}
