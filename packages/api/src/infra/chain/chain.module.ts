import { Global, Module } from '@nestjs/common';
import { createPublicClient, http } from 'viem';
import { ChainService } from './chain.service';
import { PUBLIC_CLIENT } from './chain.constants';

// @Global: balances + transactions inject ChainService without re-importing.
@Global()
@Module({
  providers: [
    {
      provide: PUBLIC_CLIENT,
      useFactory: () => {
        const rpcUrl = process.env.RPC_URL;
        if (!rpcUrl) throw new Error('RPC_URL is not configured');
        return createPublicClient({ transport: http(rpcUrl) });
      },
    },
    ChainService,
  ],
  exports: [ChainService],
})
export class ChainModule {}
