import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NATIVE_ASSET, type ContractWriteInput, type Hex, type SendTransactionInput } from '@vencura/shared';
import { type Abi, encodeDeployData, encodeFunctionData, erc20Abi, parseEther } from 'viem';
import { DEMO_TOKEN_ABI, DEMO_TOKEN_BYTECODE } from '../admin/demo-token.artifact';
import { ChainService } from '../infra/chain/chain.service';
import { EventsService } from '../infra/events/events.service';
import { LOCK, type Lock } from '../infra/lock/lock';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SIGNER, type Signer } from '../signer/signer';
import { WalletsService } from '../wallets/wallets.service';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly wallets: WalletsService,
    private readonly events: EventsService,
    @Inject(LOCK) private readonly lock: Lock,
    @Inject(SIGNER) private readonly signer: Signer,
  ) {}

  /** Write an arbitrary contract method: encode the call, then route it through the same
   *  locked send path (sign + broadcast + nonce + idempotency). `value` is wei sent (#32). */
  async writeContract(walletId: string, userId: string, input: ContractWriteInput, idempotencyKey?: string) {
    const data = encodeFunctionData({
      abi: input.abi as Abi,
      functionName: input.functionName,
      args: input.args,
    });
    return this.send(
      walletId,
      userId,
      { to: input.address, asset: 'CALL', amount: input.value, data, method: input.functionName },
      idempotencyKey,
    );
  }

  async send(
    walletId: string,
    userId: string,
    dto: SendTransactionInput & { data?: string; method?: string },
    idempotencyKey?: string,
  ) {
    const wallet = await this.wallets.findOwnedOrThrow(walletId, userId);

    return this.lock.withWalletLock(walletId, async () => {
      // Idempotency check INSIDE the lock: serialized with the create below, so two
      // concurrent requests with the same key can't both broadcast (the second sees
      // the first's row and returns it). The @unique constraint is the backstop.
      if (idempotencyKey) {
        const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey } });
        if (existing) return this.shape(existing);
      }
      const w = await this.prisma.wallet.findUnique({ where: { id: walletId } });
      const pending = await this.chain.getPendingNonce(wallet.address as Hex);
      const nonce = Math.max(pending, w!.nextNonce);
      this.logger.log(`nonce acquired: ${walletId} → ${nonce}`);

      const built = dto.data
        ? // generic contract call: raw calldata to `to`, optional value (#32)
          { from: wallet.address as Hex, to: dto.to as Hex, data: dto.data as Hex, value: BigInt(dto.amount), nonce }
        : dto.asset === NATIVE_ASSET
          ? { from: wallet.address as Hex, to: dto.to as Hex, value: BigInt(dto.amount), nonce }
          : {
              from: wallet.address as Hex,
              to: dto.asset as Hex, // token contract
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [dto.to as Hex, BigInt(dto.amount)],
              }),
              nonce,
            };

      const request = await this.chain.prepareTransaction(built);
      const raw = (await this.signer.signTransaction(walletId, request)) as Hex;
      let txHash: Hex;
      try {
        txHash = await this.chain.sendRawTransaction(raw);
      } catch (e) {
        this.logger.warn(`broadcast failed (nonce ${nonce} not consumed): ${(e as Error).message}`);
        throw new BadRequestException((e as Error).message);
      }
      this.logger.log(`tx broadcast: ${txHash} (nonce ${nonce})`);

      let row;
      try {
        row = await this.prisma.transaction.create({
          data: {
            walletId,
            idempotencyKey: idempotencyKey ?? null,
            nonce,
            status: 'pending',
            asset: dto.asset,
            amount: dto.amount,
            method: dto.method ?? null,
            toAddress: dto.to,
            fromAddress: wallet.address,
            txHash,
          },
        });
      } catch (e) {
        // CC-3: the @unique idempotencyKey is the documented backstop for a same-key conflict
        // that slips the in-lock check (e.g. concurrent same-key sends to two wallets). On
        // P2002, re-read the winning row and return it idempotently instead of a generic 500.
        const existing = await this.onUniqueConflict(e, idempotencyKey);
        if (existing) return existing;
        throw e;
      }
      await this.prisma.wallet.update({ where: { id: walletId }, data: { nextNonce: nonce + 1 } });
      this.logger.log(`nonce released: ${walletId}`);
      return this.shape(row);
    });
  }

  /** Deploy the demo ERC-20 from `walletId` (the funded admin wallet owns the full supply), then
   *  record it as the singleton demo token. Reuses the locked nonce/sign/broadcast critical section;
   *  the ~block-time receipt wait happens OUTSIDE the lock so it doesn't stall the wallet. */
  async deployDemoToken(walletId: string, userId: string) {
    const wallet = await this.wallets.findOwnedOrThrow(walletId, userId);
    const supply = parseEther('1000000'); // 1,000,000 VCD, all minted to the deployer
    const data = encodeDeployData({ abi: DEMO_TOKEN_ABI, bytecode: DEMO_TOKEN_BYTECODE, args: [supply] }) as Hex;

    const hash = await this.lock.withWalletLock(walletId, async () => {
      const w = await this.prisma.wallet.findUnique({ where: { id: walletId } });
      const pending = await this.chain.getPendingNonce(wallet.address as Hex);
      const nonce = Math.max(pending, w!.nextNonce);
      const request = await this.chain.prepareTransaction({ from: wallet.address as Hex, data, nonce }); // no `to` = deploy
      const raw = (await this.signer.signTransaction(walletId, request)) as Hex;
      let txHash: Hex;
      try {
        txHash = await this.chain.sendRawTransaction(raw);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      await this.prisma.wallet.update({ where: { id: walletId }, data: { nextNonce: nonce + 1 } });
      this.logger.log(`demo token deploy broadcast: ${txHash} (nonce ${nonce})`);
      return txHash;
    });

    const receipt = await this.chain.waitForReceipt(hash);
    if (!receipt.contractAddress) throw new BadRequestException('deploy produced no contract address');
    const saved = await this.prisma.demoToken.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', address: receipt.contractAddress, owner: wallet.address },
      update: { address: receipt.contractAddress, owner: wallet.address },
    });
    this.logger.log(`demo token deployed: ${saved.address} (owner ${saved.owner})`);
    // Durable governance event: deploying the token mints the full supply to the admin. Record it
    // in the audit trail so the mint is a first-class action, not only inferred from the chain index.
    await this.events.record({
      userId,
      walletId,
      type: 'token.deployed',
      detail: { address: saved.address, owner: saved.owner, supply: supply.toString(), txHash: hash },
      msg: `token deployed: ${saved.address} (1,000,000 VCD minted to ${saved.owner})`,
    });
    return { address: saved.address, owner: saved.owner, txHash: hash };
  }

  /** The current demo token (address + owner=spender) or null. */
  getDemoToken() {
    return this.prisma.demoToken.findUnique({ where: { id: 'singleton' }, select: { address: true, owner: true } });
  }

  list(walletId: string, userId: string) {
    return this.wallets
      .findOwnedOrThrow(walletId, userId)
      .then(() =>
        this.prisma.transaction.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      );
  }

  /** On a P2002 unique-key conflict, re-read the winning tx by idempotency key and shape it. */
  private async onUniqueConflict(e: unknown, idempotencyKey?: string) {
    const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
    if (!conflict || !idempotencyKey) return null;
    const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing) this.logger.log(`idempotency backstop hit: ${idempotencyKey}`);
    return existing ? this.shape(existing) : null;
  }

  private shape(t: { id: string; txHash: string | null; status: string; nonce: number | null }) {
    return { id: t.id, txHash: t.txHash, status: t.status, nonce: t.nonce };
  }
}
