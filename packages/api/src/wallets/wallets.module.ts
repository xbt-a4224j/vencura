import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignerModule } from '../signer/signer.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [AuthModule, SignerModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
