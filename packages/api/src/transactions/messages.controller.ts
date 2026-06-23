import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SignerRegistry } from '../signer/signer-registry.service';
import { WalletsService } from '../wallets/wallets.service';
import { SignMessageDto } from './dto';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId/messages')
export class MessagesController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly prisma: PrismaService,
    private readonly registry: SignerRegistry,
  ) {}

  @Post()
  async sign(
    @Param('walletId') walletId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: SignMessageDto,
  ) {
    const wallet = await this.wallets.findOwnedOrThrow(walletId, user.id);
    const signature = await this.registry.get(wallet.signerScheme).signMessage(walletId, dto.message);
    // Persist the off-chain action so it appears in the on/off-chain activity history.
    await this.prisma.signedMessage.create({ data: { walletId, message: dto.message, signature } });
    return { signature };
  }
}
