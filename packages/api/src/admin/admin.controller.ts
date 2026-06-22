import { Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AdminGuard } from './admin.guard';
import * as seed from './seed';

// Dev/operator controls. Gated by AdminGuard (x-admin-key === ADMIN_API_KEY) in every environment.
// Reset wipes ALL data and re-seeds the master/admin account — same behavior everywhere (testnet,
// reseedable; the on-chain master balance + token persist under the fixed key).
@ApiTags('admin')
@ApiHeader({ name: 'x-admin-key', description: 'Admin API key', required: true })
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  constructor(private readonly prisma: PrismaService) {}

  @Post('reset')
  async reset() {
    this.logger.warn('admin reset: wiping all data and re-seeding');
    // user.deleteMany cascades to wallets → transactions/balances/policies (schema onDelete: Cascade).
    await this.prisma.user.deleteMany({});
    const result = await seed.seedDemo(this.prisma);
    this.logger.log(`reset complete: re-seeded ${result.wallets.length} wallets`);
    return result;
  }
}
