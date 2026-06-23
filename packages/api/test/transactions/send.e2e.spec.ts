import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ChainModule } from '@/infra/chain/chain.module';
import { ChainService } from '@/infra/chain/chain.service';
import { LockModule } from '@/infra/lock/lock.module';
import { LOCK } from '@/infra/lock/lock';
import { EventsModule } from '@/infra/events/events.module';
import { SignerRegistry } from '@/signer/signer-registry.service';
import { TransactionsModule } from '@/transactions/transactions.module';

const prismaMock = {
  wallet: {
    findFirst: vi.fn(),
    findUnique: vi.fn().mockResolvedValue({ nextNonce: 0, address: '0xabc' }),
    update: vi.fn().mockResolvedValue({}),
  },
  transaction: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'tx1', txHash: '0xhash', status: 'pending', nonce: 0 }),
  },
};
const chainMock = {
  getPendingNonce: vi.fn().mockResolvedValue(0),
  prepareTransaction: vi.fn().mockResolvedValue({ to: '0x000000000000000000000000000000000000dEaD', value: 1n }),
  sendRawTransaction: vi.fn().mockResolvedValue('0xhash'),
};
const signerMock = { signTransaction: vi.fn().mockResolvedValue('0xraw') };
// Pass-through lock for HTTP-level tests.
const lockMock = { withWalletLock: (_id: string, fn: () => Promise<unknown>) => fn() };

describe('Send HTTP', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ChainModule, LockModule, EventsModule, TransactionsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ChainService)
      .useValue(chainMock)
      .overrideProvider(SignerRegistry)
      .useValue({ get: () => signerMock })
      .overrideProvider(LOCK)
      .useValue(lockMock)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    token = app.get(JwtService).sign({ sub: 'user-1', email: 'a@b.com' });
  });

  afterAll(async () => app?.close());

  beforeEach(() => {
    prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', address: '0xabc', signerScheme: 'encrypted' });
  });

  it('sends and returns a pending tx (201)', async () => {
    const res = await request(app.getHttpServer())
      .post('/wallets/w1/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ to: '0x000000000000000000000000000000000000dEaD', asset: 'ETH', amount: '1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ txHash: '0xhash', status: 'pending' });
  });

  it('401 without a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/wallets/w1/transactions')
      .send({ to: '0x000000000000000000000000000000000000dEaD', asset: 'ETH', amount: '1' });
    expect(res.status).toBe(401);
  });
});
