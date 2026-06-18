import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignerModule } from '../signer/signer.module';
import { WalletsModule } from '../wallets/wallets.module';
import { MessagesController } from './messages.controller';

// Hosts the "sign" operations (§6.1). Grows to hold sendTransaction in Block 4.
@Module({
  imports: [AuthModule, SignerModule, WalletsModule],
  controllers: [MessagesController],
})
export class TransactionsModule {}
