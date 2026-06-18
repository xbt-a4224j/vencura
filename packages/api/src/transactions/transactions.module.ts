import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BalancesModule } from '../balances/balances.module';
import { PolicyModule } from '../policy/policy.module';
import { SignerModule } from '../signer/signer.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ConfirmationWatcher } from './confirmation-watcher.service';
import { MessagesController } from './messages.controller';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// Hosts the sign + send operations (§6.1). ChainModule + LockModule are @Global,
// so ChainService and LOCK are injectable without re-importing here.
// BalancesModule is imported so the confirmation watcher can refresh balances on confirm.
@Module({
  imports: [AuthModule, BalancesModule, PolicyModule, SignerModule, WalletsModule],
  controllers: [MessagesController, TransactionsController],
  providers: [TransactionsService, ConfirmationWatcher],
})
export class TransactionsModule {}
