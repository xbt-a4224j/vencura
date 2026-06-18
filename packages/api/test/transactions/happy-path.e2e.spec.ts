import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { createTestClient, http as viemHttp, parseEther } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ConfirmationWatcher } from '@/transactions/confirmation-watcher.service';

// Full happy path against the REAL stack (local anvil + Postgres): create → fund →
// balance → send → confirmed. Gated by RUN_DB_TESTS (needs the docker stack); runs in
// CI with the postgres + anvil services. Manual Sepolia variant: point RPC_URL at a
// Sepolia endpoint and fund the wallet from a faucet instead of anvil_setBalance.
describe.skipIf(!process.env.RUN_DB_TESTS)('Happy path (anvil + postgres)', () => {
  let app: INestApplication;
  let watcher: ConfirmationWatcher;

  beforeAll(async () => {
    process.env.CONFIRMATIONS = '1'; // anvil on-demand-mines: a tx in the head block has 1 confirmation
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    watcher = app.get(ConfirmationWatcher);
  });

  afterAll(async () => {
    await app?.get(PrismaService).$disconnect();
    await app?.close();
  });

  it('create → fund → balance → send → confirmed', async () => {
    const api = request(app.getHttpServer());

    // 1. register + 2. create two wallets (sender + recipient)
    const email = `e2e+${Date.now()}@vencura.test`;
    const token = (await api.post('/auth/register').send({ email, password: 'password123' }).expect(201)).body
      .accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };
    const sender = (await api.post('/wallets').set(auth).send({}).expect(201)).body;
    const recipient = (await api.post('/wallets').set(auth).send({}).expect(201)).body;

    // 3. fund the sender on anvil
    const anvil = createTestClient({ mode: 'anvil', transport: viemHttp(process.env.RPC_URL) });
    await anvil.setBalance({ address: sender.address, value: parseEther('1') });

    // 4. read balance — confirmed reflects the funding
    const bal = (await api.get(`/wallets/${sender.id}/balance`).set(auth).expect(200)).body;
    expect(BigInt(bal.balances[0].confirmed)).toBeGreaterThan(0n);

    // 5. send 0.1 ETH sender → recipient
    const sent = (
      await api
        .post(`/wallets/${sender.id}/transactions`)
        .set(auth)
        .send({ to: recipient.address, asset: 'ETH', amount: parseEther('0.1').toString() })
        .expect(201)
    ).body;
    expect(sent.txHash).toMatch(/^0x[0-9a-f]+$/i);
    expect(sent.nonce).toBe(0);

    // 6. confirm: drive the watcher directly (no waiting on its 5s interval), retrying a
    // few times to absorb any mine/receipt latency. Anvil mines on demand, so this is fast.
    let status = 'pending';
    for (let i = 0; i < 20 && status !== 'confirmed'; i++) {
      await watcher.reconcile();
      const txs = (await api.get(`/wallets/${sender.id}/transactions`).set(auth).expect(200)).body as Array<{
        id: string;
        status: string;
      }>;
      status = txs.find((t) => t.id === sent.id)?.status ?? 'pending';
      if (status === 'pending') await new Promise((r) => setTimeout(r, 250));
    }
    expect(status).toBe('confirmed');
  });
});
