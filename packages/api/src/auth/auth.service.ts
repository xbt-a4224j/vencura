import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ADMIN_EMAIL, type Account, type LoginInput, type RegisterInput } from '@vencura/shared';
import * as argon2 from 'argon2';
import { EventsService } from '../infra/events/events.service';
import { PrismaService } from '../infra/prisma/prisma.service';

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly events: EventsService,
  ) {}

  async register({ email, password }: RegisterInput): Promise<AuthResult> {
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('email already registered');
    }
    // Single-tenant: exactly one self-registered (non-system) account. Once it exists,
    // registration is closed — the User view loads that one account.
    if (await this.prisma.user.findFirst({ where: { isSystem: false } })) {
      throw new ConflictException('registration is closed — only one user account is allowed');
    }
    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({ data: { email, passwordHash } });
    this.logger.log(`user registered: ${user.id}`);
    return this.issue(user);
  }

  async login({ email, password }: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same error whether the email is unknown or the password is wrong — no account enumeration.
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('invalid email or password');
    }
    this.logger.log(`login succeeded: ${user.id}`);
    // Logins are operational noise, not a governance action — they go to the ephemeral system log
    // (ring buffer), NOT the durable audit_log. Persisting them flooded the audit trail and every
    // activity feed with login rows that bury the on-chain history.
    this.events.emit(`login: ${user.email}`);
    return this.issue(user);
  }

  /** Mint a session for the system admin/operator account (no password). The admin is a seeded
   *  system identity, not a person; the controller gates this on the admin key. */
  async adminSession(): Promise<AuthResult> {
    const admin = await this.prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    if (!admin) throw new UnauthorizedException('admin account is not seeded');
    this.logger.log('admin session issued');
    return this.issue(admin);
  }

  /** The single self-registered (non-admin) user, or null if none exists yet. Drives the User
   *  view: null → show register, else → show login for that one account. */
  singleUser(): Promise<Account | null> {
    return this.prisma.user.findFirst({
      where: { isSystem: false },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private issue(user: { id: string; email: string }): AuthResult {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email } };
  }
}
