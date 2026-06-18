import { Controller, ForbiddenException, Logger, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infra/prisma/prisma.service';
import { seedDemo } from './seed';

// Dev/demo controls. Deliberately unguarded by JWT (it's a demo reset surface) but
// hard-gated off in production. Future home of reset/inspector/concurrency-demo (T-021/22/24).
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  constructor(private readonly prisma: PrismaService) {}

  @Post('seed')
  async seed() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('seeding is disabled in production');
    }
    this.logger.log('seeding demo data');
    const result = await seedDemo(this.prisma);
    this.logger.log(`seeded ${result.wallets.length} wallets for ${result.email}`);
    return result;
  }
}
