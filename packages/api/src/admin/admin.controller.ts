import { Controller, ForbiddenException, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AdminGuard } from './admin.guard';
import * as seed from './seed';

// Dev/demo controls. Gated by AdminGuard (x-admin-key === ADMIN_API_KEY) in every
// environment, so the deployed demo can still seed but randoms can't. Reset is the
// exception: it wipes ALL data, so it also hard-refuses in production (a leaked key
// must not be able to nuke a shared deployment). Future home of inspector/concurrency.
@ApiTags('admin')
@ApiHeader({ name: 'x-admin-key', description: 'Admin API key', required: true })
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  constructor(private readonly prisma: PrismaService) {}

  @Post('seed')
  async seed() {
    this.logger.log('seeding demo data');
    const result = await seed.seedDemo(this.prisma);
    this.logger.log(`seeded ${result.wallets.length} wallets for ${result.email}`);
    return result;
  }

  @Post('reset')
  async reset() {
    // Wipe-everything is dev/demo-only: never on the production deployment, even with the key.
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('reset is disabled in production');
    }
    this.logger.warn('admin reset: wiping all data and re-seeding');
    // user.deleteMany cascades to wallets → transactions/balances/policies (schema onDelete: Cascade).
    await this.prisma.user.deleteMany({});
    const result = await seed.seedDemo(this.prisma);
    this.logger.log(`reset complete: re-seeded ${result.wallets.length} wallets`);
    return result;
  }
}
