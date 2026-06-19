import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Account, LoginInput, RegisterInput } from '@vencura/shared';
import * as argon2 from 'argon2';
import { isDemoMode } from '../common/demo-mode';
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
    // Durable governance event: a successful authentication belongs in the audit trail.
    await this.events.record({
      userId: user.id,
      type: 'auth.login',
      detail: { email: user.email },
      msg: `login: ${user.email}`,
    });
    return this.issue(user);
  }

  /** Accounts for the User-view picker — id + email only, never any secret. Login still
   *  goes through `login()` with the shared demo password; this just populates the dropdown. */
  async listAccounts(): Promise<Account[]> {
    // The cross-account picker exists only for the one-click demo; a real deployment uses the
    // register/login path, so don't enumerate accounts when DEMO_MODE is off.
    if (!isDemoMode()) return [];
    // ONLY demo accounts (seed + admin-created) — they all use the shared demo password, so every
    // entry the picker shows signs in on click. Real/test registrations (isDemo=false, their own
    // passwords) are excluded so they can never 401 the picker. Demo account first as the default.
    const users = await this.prisma.user.findMany({
      where: { isDemo: true },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    const DEMO_EMAIL = 'demo@vencura.local';
    return [...users].sort((a, b) => Number(b.email === DEMO_EMAIL) - Number(a.email === DEMO_EMAIL));
  }

  private issue(user: { id: string; email: string }): AuthResult {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email } };
  }
}
