import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ChainService } from '../chain/chain.service';

// One-shot startup banner: which custody model is active, whether required secrets are present, and
// whether the RPC is reachable. Fires after all modules init (onApplicationBootstrap) but before
// traffic, so the "Live system log" opens with a self-description + health verdict. Reads env flags
// only — never logs key material, only presence.
@Injectable()
export class DiagnosticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Diagnostics');

  constructor(private readonly chain: ChainService) {}

  async onApplicationBootstrap(): Promise<void> {
    const signer =
      (process.env.SIGNER ?? 'encrypted') === 'shamir' ? 'ShamirSigner' : 'EncryptedKeySigner';
    const masterKeyOk = /^[0-9a-fA-F]{64}$/.test(process.env.MASTER_ENCRYPTION_KEY ?? '');
    const masterWalletOk = Boolean(process.env.MASTER_WALLET_PRIVKEY);

    this.logger.log('— VenCura startup diagnostics —');
    this.logger.log(`signer: ${signer}`);
    this.logger.log(`master encryption key: ${masterKeyOk ? 'present (32 bytes)' : 'MISSING/invalid'}`);
    this.logger.log(`master wallet key: ${masterWalletOk ? 'present' : 'MISSING'}`);
    this.logger.log(`ERC-20 token: ${process.env.TOKEN_ADDRESS ?? 'unset'}`);

    let rpcOk = false;
    try {
      const block = await this.chain.getBlockNumber();
      rpcOk = true;
      this.logger.log(`RPC: reachable (head block ${block})`);
    } catch (e) {
      this.logger.warn(`RPC: unreachable — ${(e as Error).message}`);
    }

    const healthy = masterKeyOk && masterWalletOk && rpcOk;
    this.logger.log(healthy ? 'health: OK' : 'health: DEGRADED (see warnings above)');
  }
}
