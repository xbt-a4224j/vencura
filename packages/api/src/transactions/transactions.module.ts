import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PolicyModule } from '../policy/policy.module';
import { SignerModule } from '../signer/signer.module';
import { WalletsModule } from '../wallets/wallets.module';
import { MessagesController } from './messages.controller';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// Hosts the sign + send operations (§6.1). ChainModule + LockModule are @Global,
// so ChainService and LOCK are injectable without re-importing here.
@Module({
  imports: [AuthModule, PolicyModule, SignerModule, WalletsModule],
  controllers: [MessagesController, TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
