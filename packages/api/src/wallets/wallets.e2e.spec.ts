import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SIGNER } from '../signer/signer';
import { WalletsModule } from './wallets.module';

const prismaMock = { wallet: { create: vi.fn(), findMany: vi.fn() } };
const signerMock = {
  createKey: vi.fn().mockResolvedValue({
    address: '0xWALLET',
    encryptedPrivateKey: 'ct',
    encryptionIv: 'iv',
    encryptionAuthTag: 'tag',
  }),
};

describe('Wallets HTTP', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, WalletsModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(SIGNER)
      .useValue(signerMock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    token = app.get(JwtService).sign({ sub: 'user-1', email: 'a@b.com' });
  });

  afterAll(async () => app?.close());

  it('rejects an unauthenticated create with 401', async () => {
    expect((await request(app.getHttpServer()).post('/wallets')).status).toBe(401);
  });

  it('creates a wallet for the authed user and returns only id + address', async () => {
    prismaMock.wallet.create.mockResolvedValue({ id: 'w1', address: '0xWALLET' });
    const res = await request(app.getHttpServer())
      .post('/wallets')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'w1', address: '0xWALLET' });
    expect(JSON.stringify(res.body)).not.toContain('ct');
  });
});
