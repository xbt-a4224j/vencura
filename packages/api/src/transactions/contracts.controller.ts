import { Body, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Hex } from '@vencura/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChainService } from '../infra/chain/chain.service';
import { ContractReadDto, ContractWriteDto } from './contract.dto';
import { TransactionsService } from './transactions.service';

// Generic contract read/write (#32). Read is a view-only eth_call (no wallet, no lock);
// write encodes the call and routes it through the locked send path.
@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ContractsController {
  constructor(
    private readonly chain: ChainService,
    private readonly transactions: TransactionsService,
  ) {}

  @Post('contract/read')
  async read(@Body() dto: ContractReadDto) {
    const result = await this.chain.readContract({ ...dto, address: dto.address as Hex });
    return { result: jsonSafe(result) }; // bigints → strings so the JSON serializes
  }

  @Post('wallets/:walletId/contract/write')
  write(
    @Param('walletId') walletId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ContractWriteDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    return this.transactions.writeContract(walletId, user.id, dto, idempotencyKey);
  }
}

/** Recursively convert bigints (and bigints nested in arrays/objects) to strings. */
function jsonSafe(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, jsonSafe(val)]));
  }
  return v;
}
