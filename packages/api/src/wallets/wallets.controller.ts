import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ADMIN_EMAIL } from '@vencura/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateWalletDto } from './dto';
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

  /** Create a wallet with an explicit key scheme (encrypted or shamir). Multiple wallets per user
   *  are allowed via this endpoint; each is independent with its own key. */
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateWalletDto) {
    return this.wallets.create(user.id, dto.scheme);
  }

  /** One wallet per account: return the user's wallet, creating + funding it on first call. */
  @Post('provision')
  provision(@CurrentUser() user: { id: string }) {
    return this.provisioning.provision(user.id);
  }

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.wallets.list(user.id);
  }

  /** Admin-only: every platform wallet (address + owner email) for the token-flow holder picker. */
  @Get('holders')
  holders(@CurrentUser() user: { email: string }) {
    if (user.email !== ADMIN_EMAIL) throw new ForbiddenException();
    return this.wallets.listHolders();
  }

  /** Admin operator console: every platform wallet (owner email + cached balance + self flag). */
  @Get('all')
  all(@CurrentUser() user: { id: string; email: string }) {
    if (user.email !== ADMIN_EMAIL) throw new ForbiddenException();
    return this.wallets.listAll(user.id);
  }
}
