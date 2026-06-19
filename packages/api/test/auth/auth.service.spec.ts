import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { EventsService } from '@/infra/events/events.service';
import { AuthService } from '@/auth/auth.service';

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null), // no existing non-admin user → register allowed
    findMany: vi.fn(),
    create: vi.fn(),
  },
};
const eventsMock = { record: vi.fn().mockResolvedValue(undefined), emit: vi.fn() };

describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1d' } })],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventsService, useValue: eventsMock },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  it('register hashes the password (never stores plaintext) and returns a verifiable token', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'u1', email: data.email }),
    );

    const result = await service.register({ email: 'a@b.com', password: 'password123' });

    const created = prismaMock.user.create.mock.calls[0][0].data;
    expect(created.passwordHash).not.toBe('password123');
    expect(await argon2.verify(created.passwordHash, 'password123')).toBe(true);
    expect(jwt.verify(result.accessToken)).toMatchObject({ sub: 'u1', email: 'a@b.com' });
    expect(result.user).toEqual({ id: 'u1', email: 'a@b.com' });
    expect(JSON.stringify(result)).not.toContain('password123');
  });

  it('register rejects a duplicate email with 409', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    await expect(
      service.register({ email: 'a@b.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('login rejects a wrong password with 401', async () => {
    const passwordHash = await argon2.hash('password123');
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash });
    await expect(
      service.login({ email: 'a@b.com', password: 'wrong-pass' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // The User-view picker lists accounts; login still uses the shared demo password.
  it('listAccounts returns id + email only (no secrets), oldest first', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.com' }]);
    const accounts = await service.listAccounts();
    expect(prismaMock.user.findMany.mock.calls[0][0]).toMatchObject({
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(accounts).toEqual([{ id: 'u1', email: 'a@b.com' }]);
  });
});
