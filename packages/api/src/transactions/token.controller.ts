import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionsService } from './transactions.service';

// The fixed ERC-20 (approve/transferFrom demo). GET /token is shared so both the admin
// (owner/spender) and the user (token holder) read the same pre-deployed address.
@ApiTags('token')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TokenController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get('token')
  current() {
    return this.transactions.getDemoToken();
  }
}
