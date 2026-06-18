import { Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AdminGuard } from './admin.guard';
import { seedDemo } from './seed';

// Dev/demo controls. Gated by AdminGuard (x-admin-key === ADMIN_API_KEY) in every
// environment, so the deployed demo can still seed/reset but randoms can't.
// Future home of reset/inspector/concurrency-demo (T-021/22/24).
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
    const result = await seedDemo(this.prisma);
    this.logger.log(`seeded ${result.wallets.length} wallets for ${result.email}`);
    return result;
  }
}
