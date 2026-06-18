import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';

// ChainModule is @Global, so ChainService is available without importing it.
@Module({
  imports: [AuthModule, WalletsModule],
  controllers: [BalancesController],
  providers: [BalancesService],
  exports: [BalancesService],
})
export class BalancesModule {}
