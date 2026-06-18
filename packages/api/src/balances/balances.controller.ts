import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BalancesService } from './balances.service';

@ApiTags('balances')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId/balance')
export class BalancesController {
  constructor(private readonly balances: BalancesService) {}

  @Get()
  get(@Param('walletId') walletId: string, @CurrentUser() user: { id: string }) {
    return this.balances.getBalances(walletId, user.id);
  }
}
