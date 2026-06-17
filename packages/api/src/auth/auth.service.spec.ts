import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AuthService } from './auth.service';

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
};

describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1d' } })],
      providers: [AuthService, { provide: PrismaService, useValue: prismaMock }],
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
});
