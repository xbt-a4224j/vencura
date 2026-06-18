import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SendTransactionDto } from './send.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  send(
    @Param('walletId') walletId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: SendTransactionDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    return this.transactions.send(walletId, user.id, dto, idempotencyKey);
  }

  @Get()
  list(@Param('walletId') walletId: string, @CurrentUser() user: { id: string }) {
    return this.transactions.list(walletId, user.id);
  }
}
