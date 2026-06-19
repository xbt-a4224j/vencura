import { Injectable } from '@nestjs/common';
import { isDemoMode, maskEmail } from '../common/demo-mode';
import { PrismaService } from '../infra/prisma/prisma.service';

export interface Person {
  accountId: string;
  email: string;
  address: string;
}

/** The Venmo-style recipient directory: every OTHER account with a payable wallet. */
@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Other accounts' first (oldest) wallet address. Skips the caller and walletless accounts.
   *  Cross-tenant enumeration is a demo affordance (a real product scopes payees to saved
   *  contacts), so it's gated on DEMO_MODE; emails are masked so the directory never leaks a full
   *  address even in demo. */
  async list(callerId: string): Promise<Person[]> {
    if (!isDemoMode()) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { not: callerId } },
      select: {
        id: true,
        email: true,
        wallets: { orderBy: { createdAt: 'asc' }, take: 1, select: { address: true } },
      },
      orderBy: { email: 'asc' },
    });
    return users
      .filter((u) => u.wallets.length > 0)
      .map((u) => ({ accountId: u.id, email: maskEmail(u.email), address: u.wallets[0].address }));
  }
}
