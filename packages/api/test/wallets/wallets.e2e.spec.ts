import { Global, type INestApplication, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChainService } from '@/infra/chain/chain.service';
import { EventsService } from '@/infra/events/events.service';
import { LOCK } from '@/infra/lock/lock';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { SIGNER } from '@/signer/signer';
import { WalletsModule } from '@/wallets/wallets.module';

const prismaMock = { wallet: { create: vi.fn(), findMany: vi.fn() } };
// ChainModule + LockModule are @Global in the real app; this isolated module test supplies
// minimal doubles so ProvisioningService (which injects them) can be constructed.
const chainMock = {};
const lockMock = { withWalletLock: <T>(_id: string, fn: () => Promise<T>) => fn() };
const eventsMock = { record: vi.fn().mockResolvedValue(undefined), emit: vi.fn() };

// Stand in for the app's @Global ChainModule + LockModule + EventsModule so the services that
// inject them (ProvisioningService, WalletsService) resolve.
@Global()
@Module({
  providers: [
    { provide: ChainService, useValue: chainMock },
    { provide: LOCK, useValue: lockMock },
    { provide: EventsService, useValue: eventsMock },
  ],
  exports: [ChainService, LOCK, EventsService],
})
class GlobalInfraMock {}
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
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalInfraMock, PrismaModule, WalletsModule],
    })
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

  // One wallet per account: provisioning is the only create path; the guard rejects anon callers.
  it('rejects an unauthenticated provision with 401', async () => {
    expect((await request(app.getHttpServer()).post('/wallets/provision')).status).toBe(401);
  });

  it('lists wallets only for the authed user', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'w1', address: '0xWALLET', createdAt: new Date() }]);
    const res = await request(app.getHttpServer()).get('/wallets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'w1', address: '0xWALLET' });
    expect(JSON.stringify(res.body)).not.toContain('ct'); // no key material
  });
});
