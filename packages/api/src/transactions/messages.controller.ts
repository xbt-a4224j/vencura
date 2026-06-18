import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SIGNER, type Signer } from '../signer/signer';
import { WalletsService } from '../wallets/wallets.service';
import { SignMessageDto } from './dto';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId/messages')
export class MessagesController {
  constructor(
    private readonly wallets: WalletsService,
    @Inject(SIGNER) private readonly signer: Signer,
  ) {}

  @Post()
  async sign(
    @Param('walletId') walletId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: SignMessageDto,
  ) {
    await this.wallets.findOwnedOrThrow(walletId, user.id); // authz before touching the key
    const signature = await this.signer.signMessage(walletId, dto.message);
    return { signature };
  }
}
