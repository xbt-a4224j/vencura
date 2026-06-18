import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PolicyController } from './policy.controller';
import { PolicyEngine } from './policy.engine';

@Module({
  imports: [AuthModule, WalletsModule],
  controllers: [PolicyController],
  providers: [PolicyEngine],
  exports: [PolicyEngine],
})
export class PolicyModule {}
