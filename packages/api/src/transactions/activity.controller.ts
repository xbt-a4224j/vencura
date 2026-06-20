import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ADMIN_EMAIL } from '@vencura/shared';
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

// Cross-wallet unified activity — backs the Activity tab's audit view (one call instead of N
// per-wallet polls). The admin operator sees system-wide activity (every tenant); a regular user
// sees only their own wallets' events.
@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('activity')
export class UserActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  recent(@CurrentUser() user: { id: string; email: string }) {
    return user.email === ADMIN_EMAIL
      ? this.activity.recentSystemWide()
      : this.activity.recentForUser(user.id);
  }
}
