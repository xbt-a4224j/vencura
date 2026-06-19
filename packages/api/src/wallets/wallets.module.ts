import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignerModule } from '../signer/signer.module';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { ProvisioningService } from './provisioning.service';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

// ChainModule + LockModule are @Global, so ChainService and LOCK inject into
// ProvisioningService without re-importing them here.
@Module({
  imports: [AuthModule, SignerModule],
  controllers: [WalletsController, PeopleController],
  providers: [WalletsService, ProvisioningService, PeopleService],
  exports: [WalletsService],
})
export class WalletsModule {}
