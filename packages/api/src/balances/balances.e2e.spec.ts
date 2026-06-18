import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ChainModule } from '../infra/chain/chain.module';
import { ChainService } from '../infra/chain/chain.service';
import { BalancesModule } from './balances.module';

const prismaMock = {
  wallet: { findFirst: vi.fn() },
  walletBalance: { findMany: vi.fn(), upsert: vi.fn() },
};
const chainMock = {
  getBlockNumber: vi.fn().mockResolvedValue(1n),
  getNativeBalance: vi.fn().mockResolvedValue(0n),
  getErc20Balance: vi.fn(),
};

describe('Balances HTTP', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.RPC_URL = 'http://localhost:8545'; // ChainModule's PUBLIC_CLIENT factory needs it (no network call at creation)
    process.env.MASTER_ENCRYPTION_KEY = 'a'.repeat(64); // WalletsModule→SignerModule instantiates EncryptedKeySigner (unused here)
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ChainModule, BalancesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ChainService)
      .useValue(chainMock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    token = app.get(JwtService).sign({ sub: 'user-1', email: 'a@b.com' });
  });

  afterAll(async () => app?.close());

  it('401 without a token', async () => {
    expect((await request(app.getHttpServer()).get('/wallets/w1/balance')).status).toBe(401);
  });

  it('404 when the wallet is not owned', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue(null);
    const res = await request(app.getHttpServer())
      .get('/wallets/w1/balance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns balances for an owned wallet', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', address: '0xabc' });
    prismaMock.walletBalance.findMany.mockResolvedValue([
      { walletId: 'w1', asset: 'ETH', confirmed: '1000', asOfBlock: 5, updatedAt: new Date() },
    ]);
    const res = await request(app.getHttpServer())
      .get('/wallets/w1/balance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balances[0]).toMatchObject({ asset: 'ETH', confirmed: '1000', available: '1000' });
  });
});
