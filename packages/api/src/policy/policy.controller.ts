import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WalletsService } from '../wallets/wallets.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { PolicyDto } from './dto';

@ApiTags('policy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId/policy')
export class PolicyController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async get(@Param('walletId') walletId: string, @CurrentUser() user: { id: string }) {
    await this.wallets.findOwnedOrThrow(walletId, user.id);
    return (
      (await this.prisma.walletPolicy.findUnique({ where: { walletId } })) ?? {
        walletId,
        allowlist: [],
        perTxLimit: null,
        dailyLimit: null,
      }
    );
  }

  @Put()
  async set(@Param('walletId') walletId: string, @CurrentUser() user: { id: string }, @Body() dto: PolicyDto) {
    await this.wallets.findOwnedOrThrow(walletId, user.id);
    return this.prisma.walletPolicy.upsert({
      where: { walletId },
      create: { walletId, ...dto },
      update: { ...dto },
    });
  }
}
