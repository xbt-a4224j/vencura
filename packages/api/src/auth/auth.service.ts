import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginInput, RegisterInput } from '@vencura/shared';
import * as argon2 from 'argon2';
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
    return this.issue(user);
  }

  private issue(user: { id: string; email: string }): AuthResult {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email } };
  }
}
