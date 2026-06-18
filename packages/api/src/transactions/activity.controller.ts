import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityService } from './activity.service';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  recent(@Param('walletId') walletId: string, @CurrentUser() user: { id: string }) {
    return this.activity.recent(walletId, user.id);
  }
}
