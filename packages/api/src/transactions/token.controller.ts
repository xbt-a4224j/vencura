import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionsService } from './transactions.service';

// The demo ERC-20 (approve/transferFrom demo). Deploy is exposed in the Admin view only, but it's a
// normal authenticated wallet action (the deployer wallet pays gas + owns the supply). GET /token is
// shared so both the admin (deployer/spender) and the user (token holder) read the same address.
@ApiTags('token')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TokenController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post('wallets/:walletId/deploy-token')
  deploy(@Param('walletId') walletId: string, @CurrentUser() user: { id: string }) {
    return this.transactions.deployDemoToken(walletId, user.id);
  }

  @Get('token')
  current() {
    return this.transactions.getDemoToken();
  }
}
