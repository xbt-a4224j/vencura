import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BalancesModule } from '../balances/balances.module';
import { PolicyModule } from '../policy/policy.module';
import { SignerModule } from '../signer/signer.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ActivityController, UserActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ConfirmationWatcher } from './confirmation-watcher.service';
import { ContractsController } from './contracts.controller';
import { IncomingWatcher } from './incoming-watcher.service';
import { MessagesController } from './messages.controller';
import { TokenController } from './token.controller';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// Hosts the sign + send operations and the unified on/off-chain activity history (§6.1).
// ChainModule + LockModule are @Global, so ChainService and LOCK inject without re-importing.
// BalancesModule is imported so the confirmation watcher can refresh balances on confirm.
@Module({
  imports: [AuthModule, BalancesModule, PolicyModule, SignerModule, WalletsModule],
  controllers: [
    MessagesController,
    TransactionsController,
    ActivityController,
    UserActivityController,
    ContractsController,
    TokenController,
  ],
  providers: [TransactionsService, ConfirmationWatcher, IncomingWatcher, ActivityService],
})
export class TransactionsModule {}
