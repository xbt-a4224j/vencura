import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ChainModule } from '@/infra/chain/chain.module';
import { ChainService } from '@/infra/chain/chain.service';
import { LockModule } from '@/infra/lock/lock.module';
import { EventsModule } from '@/infra/events/events.module';
import { SIGNER } from '@/signer/signer';
import { TransactionsModule } from '@/transactions/transactions.module';

const prismaMock = {
  wallet: { findFirst: vi.fn() },
  signedMessage: { create: vi.fn().mockResolvedValue({}) },
};
const signerMock = { signMessage: vi.fn().mockResolvedValue('0xsig') };
const chainMock = {};

describe('Messages HTTP', () => {
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
      .overrideProvider(SIGNER)
      .useValue(signerMock)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    token = app.get(JwtService).sign({ sub: 'user-1', email: 'a@b.com' });
  });

  afterAll(async () => app?.close());

  it('signs a message for an owned wallet', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', address: '0xabc' });
    const res = await request(app.getHttpServer())
      .post('/wallets/w1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'gm' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ signature: '0xsig' });
  });

  it('404 when not owned', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue(null);
    const res = await request(app.getHttpServer())
      .post('/wallets/w1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'gm' });
    expect(res.status).toBe(404);
  });

  it('400 on empty message', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', address: '0xabc' });
    const res = await request(app.getHttpServer())
      .post('/wallets/w1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('401 without a token', async () => {
    const res = await request(app.getHttpServer()).post('/wallets/w1/messages').send({ message: 'gm' });
    expect(res.status).toBe(401);
  });
});
