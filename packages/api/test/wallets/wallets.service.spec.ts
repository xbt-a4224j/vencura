import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { EventsService } from '@/infra/events/events.service';
import { SIGNER } from '@/signer/signer';
import { WalletsService } from '@/wallets/wallets.service';

const prismaMock = { wallet: { create: vi.fn(), findMany: vi.fn() } };
const eventsMock = { record: vi.fn().mockResolvedValue(undefined), emit: vi.fn() };
const signerMock = {
  createKey: vi.fn(),
  getAddress: vi.fn(),
  signMessage: vi.fn(),
  signTransaction: vi.fn(),
};

describe('WalletsService', () => {
  let service: WalletsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SIGNER, useValue: signerMock },
        { provide: EventsService, useValue: eventsMock },
      ],
    }).compile();
    service = moduleRef.get(WalletsService);
  });

  it('create persists the encrypted envelope but returns only id + address', async () => {
    signerMock.createKey.mockResolvedValue({
      address: '0xWALLET',
      encryptedPrivateKey: 'ct',
      encryptionIv: 'iv',
      encryptionAuthTag: 'tag',
    });
    prismaMock.wallet.create.mockResolvedValue({ id: 'w1', address: '0xWALLET' });

    const result = await service.create('user-1');

    const persisted = prismaMock.wallet.create.mock.calls[0][0].data;
    expect(persisted).toMatchObject({
      userId: 'user-1',
      encryptedPrivateKey: 'ct',
      encryptionAuthTag: 'tag',
    });
    expect(result).toEqual({ id: 'w1', address: '0xWALLET' });
    expect(JSON.stringify(result)).not.toContain('ct'); // no key material leaks
  });

  it('list is scoped to the requesting user', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'w1', address: '0xA', createdAt: new Date() }]);
    await service.list('user-1');
    expect(prismaMock.wallet.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'user-1' } });
  });
});
