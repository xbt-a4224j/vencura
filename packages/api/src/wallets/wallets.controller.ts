import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProvisioningService } from './provisioning.service';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly provisioning: ProvisioningService,
  ) {}

  /** One wallet per account: return the user's wallet, creating + funding it on first call.
   *  (There is no create-additional endpoint — the model is exactly one wallet per account.) */
  @Post('provision')
  provision(@CurrentUser() user: { id: string }) {
    return this.provisioning.provision(user.id);
  }

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.wallets.list(user.id);
  }
}
