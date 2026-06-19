import { Body, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransferDto } from './transfer.dto';
import { TransactionsService } from './transactions.service';

// Account ↔ account transfers between a user's own wallets (#30). A thin wrapper over
// the send path: resolves the destination address and reuses lock/nonce/policy/idempotency.
@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId/transfers')
export class TransfersController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  transfer(
    @Param('walletId') walletId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: TransferDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    return this.transactions.transfer(walletId, user.id, dto, idempotencyKey);
  }
}
