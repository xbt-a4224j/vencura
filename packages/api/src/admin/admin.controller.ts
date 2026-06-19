import { Body, ConflictException, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { DEMO_PASSWORD } from '@vencura/shared';
import * as argon2 from 'argon2';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AdminGuard } from './admin.guard';
import * as seed from './seed';

class CreateDemoAccountDto extends createZodDto(z.object({ email: z.string().email() })) {}

// Dev/demo controls. Gated by AdminGuard (x-admin-key === ADMIN_API_KEY) in every
// environment, so the deployed demo can seed/reset but randoms can't. Reset wipes ALL
// data and re-seeds — same behavior everywhere (testnet demo data is reseedable).
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

  // Admin-created accounts are demo accounts: shared demo password + isDemo, so they show in the
  // User-view picker and sign in on click. (Public POST /auth/register stays for real accounts,
  // which are NOT demo accounts and never appear in the picker.)
  @Post('accounts')
  async createAccount(@Body() dto: CreateDemoAccountDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('email already registered');
    }
    const passwordHash = await argon2.hash(DEMO_PASSWORD);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, isDemo: true },
      select: { id: true, email: true },
    });
    this.logger.log(`admin created demo account: ${email}`);
    return user;
  }


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
