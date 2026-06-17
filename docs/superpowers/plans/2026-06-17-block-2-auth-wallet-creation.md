# Block 2 — Auth & Wallet Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can register, log in (JWT), and create a custodial Ethereum wallet whose private key is generated, AES-256-GCM-encrypted at rest, and never returned or logged — all reachable from a React admin.

**Architecture:** NestJS feature modules (`auth`, `signer`, `wallets`) over the existing Prisma schema. Request validation is zod schemas in `packages/shared` surfaced through `nestjs-zod` (one schema = runtime validator + OpenAPI definition). Key custody lives behind a single `Signer` seam (DI token) implemented by `EncryptedKeySigner`. A Vite + React SPA in `packages/web` drives every capability.

**Tech Stack:** TypeScript, NestJS 11, Prisma/Postgres, zod + nestjs-zod, @nestjs/jwt + passport-jwt, argon2, viem, Vitest + supertest, Vite + React.

**Spec:** `docs/superpowers/specs/2026-06-17-block-2-auth-wallet-creation-design.md`

**Conventions (from Block 1):**
- Tests are `*.spec.ts` beside source; boot Nest via `Test.createTestingModule` + `supertest`, or unit-test providers with mocked `PrismaService` (`{ provide: PrismaService, useValue: mock }`).
- Per-package commands: `pnpm --filter @vencura/<pkg> <script>`. Run a single test file: `pnpm --filter @vencura/api exec vitest run <path>`.
- **One commit per ticket, directly to `main`**, conventional-commit message, **no `Co-Authored-By`**. Append a `DEVLOG.md` entry (§12 template, ≤120 words) as the last step of each ticket.
- Verify gate before each commit (§11): `pnpm --filter @vencura/<pkg> lint && … typecheck && … test && … build` — paste real output into the DEVLOG.

---

## File Structure

**`packages/shared/src/`** (new)
- `auth.schema.ts` — `RegisterSchema`, `LoginSchema` + inferred types.
- `index.ts` — re-export the above (modify).

**`packages/api/src/`**
- `main.ts` — register global `ZodValidationPipe`, call `patchNestjsSwagger()` (modify).
- `app.module.ts` — import `AuthModule`, `SignerModule`, `WalletsModule` (modify).
- `auth/` — `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `dto.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`, `current-user.decorator.ts` + specs.
- `signer/` — `signer.ts` (interface + `SIGNER` token + envelope type), `aes-256-gcm.ts`, `encrypted-key.signer.ts`, `signer.module.ts` + specs.
- `wallets/` — `wallets.module.ts`, `wallets.controller.ts`, `wallets.service.ts`, `dto.ts` + specs.

**`packages/web/`** (convert lib stub → SPA)
- `index.html`, `vite.config.ts`, `tsconfig.json` (modify), `package.json` (modify), delete `src/index.ts`/`dist`.
- `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/auth-context.tsx`.

---

## Task 1 — T-007: JWT auth (register / login)

**Files:**
- Create: `packages/shared/src/auth.schema.ts`, `packages/api/src/auth/{auth.module,auth.controller,auth.service,dto,jwt.strategy,jwt-auth.guard,current-user.decorator}.ts`
- Test: `packages/api/src/auth/{auth.service,auth.e2e}.spec.ts`
- Modify: `packages/shared/src/index.ts`, `packages/api/src/main.ts`, `packages/api/src/app.module.ts`

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @vencura/shared add zod@^3.23.8
pnpm --filter @vencura/api add zod@^3.23.8 nestjs-zod @nestjs/jwt @nestjs/passport passport passport-jwt argon2
pnpm --filter @vencura/api add -D @types/passport-jwt
```
Note: `zod` is added to **both** `shared` and `api` at the **same version** so `createZodDto` and the schemas share one zod instance (avoids `instanceof` mismatches). If `nestjs-zod` reports a zod peer conflict, pin zod to the version in its peerDependencies and re-run.

- [ ] **Step 2: Write the shared auth schemas**

`packages/shared/src/auth.schema.ts`:
```ts
import { z } from 'zod';

/** Registration / login input. Password floor is deliberately low for demo seeding;
 *  raise for production. Email is normalized to lowercase so logins are case-insensitive. */
export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'password must be at least 8 characters'),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = RegisterSchema;
export type LoginInput = z.infer<typeof LoginSchema>;
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './auth.schema';
```

- [ ] **Step 3: Wire global validation + Swagger in `main.ts`**

In `packages/api/src/main.ts`, add imports and two lines (place `patchNestjsSwagger()` BEFORE `createDocument`, and `useGlobalPipes` after `NestFactory.create`):
```ts
import { ZodValidationPipe, patchNestjsSwagger } from 'nestjs-zod';
// ...
const app = await NestFactory.create(AppModule);
app.useGlobalPipes(new ZodValidationPipe());
patchNestjsSwagger();
```
Note: the Swagger-patch export name has varied across `nestjs-zod` majors (`patchNestjsSwagger` / `patchNestJsSwagger`). Confirm against the installed version's `dist` types; use the one that exists.

- [ ] **Step 4: Write the DTOs (createZodDto)**

`packages/api/src/auth/dto.ts`:
```ts
import { createZodDto } from 'nestjs-zod';
import { LoginSchema, RegisterSchema } from '@vencura/shared';

export class RegisterDto extends createZodDto(RegisterSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
```

- [ ] **Step 5: Write the failing AuthService test**

`packages/api/src/auth/auth.service.spec.ts`:
```ts
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
    await expect(service.register({ email: 'a@b.com', password: 'password123' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('login rejects a wrong password with 401', async () => {
    const passwordHash = await argon2.hash('password123');
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash });
    await expect(service.login({ email: 'a@b.com', password: 'wrong-pass' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 6: Run the test — verify it fails**

Run: `pnpm --filter @vencura/api exec vitest run src/auth/auth.service.spec.ts`
Expected: FAIL — cannot find `./auth.service`.

- [ ] **Step 7: Implement `AuthService`**

`packages/api/src/auth/auth.service.ts`:
```ts
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginInput, RegisterInput } from '@vencura/shared';
import * as argon2 from 'argon2';
import { PrismaService } from '../infra/prisma/prisma.service';

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register({ email, password }: RegisterInput): Promise<AuthResult> {
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('email already registered');
    }
    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({ data: { email, passwordHash } });
    this.logger.log(`user registered: ${user.id}`);
    return this.issue(user);
  }

  async login({ email, password }: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same error whether the email is unknown or the password is wrong — no account enumeration.
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('invalid email or password');
    }
    this.logger.log(`login succeeded: ${user.id}`);
    return this.issue(user);
  }

  private issue(user: { id: string; email: string }): AuthResult {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email } };
  }
}
```

- [ ] **Step 8: Run the test — verify it passes**

Run: `pnpm --filter @vencura/api exec vitest run src/auth/auth.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Implement the JWT strategy, guard, and current-user decorator**

`packages/api/src/auth/jwt.strategy.ts`:
```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
}

/** Validates the bearer token's signature/expiry, then shapes `req.user`. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new UnauthorizedException('JWT_SECRET is not configured');
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret });
  }

  validate(payload: JwtPayload): { id: string; email: string } {
    return { id: payload.sub, email: payload.email };
  }
}
```

`packages/api/src/auth/jwt-auth.guard.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Apply with `@UseGuards(JwtAuthGuard)`; populates `req.user` from the bearer token. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

`packages/api/src/auth/current-user.decorator.ts`:
```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
}

/** Injects the authenticated user shaped by JwtStrategy.validate(). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 10: Implement the controller and module**

`packages/api/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
```

`packages/api/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '1d' } }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
```
Import `AuthModule` in `packages/api/src/app.module.ts`:
```ts
import { AuthModule } from './auth/auth.module';
// @Module({ imports: [PrismaModule, AuthModule, HealthModule] })
```

- [ ] **Step 11: Write the HTTP e2e test (validation + guard)**

`packages/api/src/auth/auth.e2e.spec.ts`:
```ts
import { Controller, Get, type INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AuthModule } from './auth.module';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

// A throwaway protected route to prove the guard accepts/rejects tokens.
@Controller('protected')
class ProbeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  whoami(@CurrentUser() user: { id: string }) {
    return user;
  }
}

const prismaMock = { user: { findUnique: vi.fn(), create: vi.fn() } };

describe('Auth HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [ProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
  });

  afterAll(async () => app.close());

  it('rejects invalid registration input with 400', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send({ email: 'nope', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('register → token → guarded route returns the user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'a@b.com', password: 'password123' });
    expect(reg.status).toBe(201);

    const noAuth = await request(app.getHttpServer()).get('/protected');
    expect(noAuth.status).toBe(401);

    const ok = await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ id: 'u1', email: 'a@b.com' });
  });
});
```

- [ ] **Step 12: Run the full auth suite — verify green**

Run: `pnpm --filter @vencura/api exec vitest run src/auth`
Expected: PASS (all auth specs).

- [ ] **Step 13: Verify gate (lint + typecheck + test + build)**

Run: `pnpm --filter @vencura/shared build && pnpm --filter @vencura/api lint && pnpm --filter @vencura/api typecheck && pnpm --filter @vencura/api test && pnpm --filter @vencura/api build`
Expected: all green. (Build `shared` first so `@vencura/shared` types resolve.)

- [ ] **Step 14: Commit + DEVLOG**

```bash
git add -A
git commit -m "feat(api): JWT auth — register/login with argon2 + zod validation (T-007)"
```
Append a `DEVLOG.md` entry (§12 template, ≤120 words): goal (register/login + JWT); mechanism (argon2id hash, access-token-only, zod-in-shared via nestjs-zod, passport-jwt guard, no account enumeration); files touched; the `register`/`login` signatures; tests (hash-not-plaintext, 409, 401, guard accept/reject); demo (curl `/auth/register`); gotchas (zod single-instance across packages; global filter deferred to T-019). Link the issue + commit URLs. Commit the DEVLOG:
```bash
git add DEVLOG.md && git commit -m "docs(devlog): T-007 entry"
```

---

## Task 2 — T-008: `Signer` interface + `EncryptedKeySigner`

**Files:**
- Create: `packages/api/src/signer/{signer,aes-256-gcm,encrypted-key.signer,signer.module}.ts`
- Test: `packages/api/src/signer/{aes-256-gcm,encrypted-key.signer}.spec.ts`
- Modify: `packages/api/src/app.module.ts`

- [ ] **Step 1: Install viem**

```bash
pnpm --filter @vencura/api add viem
```

- [ ] **Step 2: Write the failing crypto helper test**

`packages/api/src/signer/aes-256-gcm.spec.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './aes-256-gcm';

const key = randomBytes(32);

describe('aes-256-gcm', () => {
  it('round-trips plaintext', () => {
    const envelope = encrypt('0xdeadbeef', key);
    expect(decrypt(envelope, key).toString('utf8')).toBe('0xdeadbeef');
  });

  it('uses a fresh IV per call (same input → different ciphertext)', () => {
    expect(encrypt('same', key).ciphertext).not.toBe(encrypt('same', key).ciphertext);
  });

  it('throws when the auth tag is tampered (GCM authentication)', () => {
    const envelope = encrypt('0xsecret', key);
    const tampered = { ...envelope, authTag: '00'.repeat(16) };
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('throws when decrypted with the wrong key', () => {
    const envelope = encrypt('0xsecret', key);
    expect(() => decrypt(envelope, randomBytes(32))).toThrow();
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @vencura/api exec vitest run src/signer/aes-256-gcm.spec.ts`
Expected: FAIL — cannot find `./aes-256-gcm`.

- [ ] **Step 4: Implement the crypto helper**

`packages/api/src/signer/aes-256-gcm.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length

/** The encrypted-key columns on the Wallet model (CLAUDE.md §4). Hex-encoded. */
export interface EncryptedEnvelope {
  encryptedPrivateKey: string;
  encryptionIv: string;
  encryptionAuthTag: string;
}

/** Encrypt with a fresh random IV. Returns the decomposed envelope persisted on the wallet. */
export function encrypt(plaintext: string, masterKey: Buffer): EncryptedEnvelope {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encryptedPrivateKey: ciphertext.toString('hex'),
    encryptionIv: iv.toString('hex'),
    encryptionAuthTag: cipher.getAuthTag().toString('hex'),
  };
}

/** Decrypt; throws if the auth tag does not verify (tampering or wrong key).
 *  Returns a Buffer so the caller can zeroize it after signing (relevant from T-012). */
export function decrypt(envelope: EncryptedEnvelope, masterKey: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(envelope.encryptionIv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.encryptionAuthTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.encryptedPrivateKey, 'hex')),
    decipher.final(),
  ]);
}
```
Note: the small bracket of `encrypt`'s mapping to the three columns is the contract `Wallet` already declares. Confused-name field check: `EncryptedEnvelope` field names (`encryptedPrivateKey`/`encryptionIv`/`encryptionAuthTag`) match the Prisma columns exactly so the wallet service can spread it.

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @vencura/api exec vitest run src/signer/aes-256-gcm.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the `Signer` seam (interface + token)**

`packages/api/src/signer/signer.ts`:
```ts
import type { EncryptedEnvelope } from './aes-256-gcm';

/** A newly generated, encrypted keypair ready to persist on a Wallet row. */
export interface NewKey extends EncryptedEnvelope {
  address: string;
}

/** The one custody abstraction (CLAUDE.md §3/§4). Swap the implementation
 *  (EncryptedKeySigner → ShamirSigner → MPC) without touching consumers. */
export interface Signer {
  createKey(): Promise<NewKey>;
  getAddress(walletId: string): Promise<string>;
  signMessage(walletId: string, message: string): Promise<string>;
  signTransaction(walletId: string, tx: unknown): Promise<string>;
}

/** DI token — `interface` can't be injected by type, so consumers use `@Inject(SIGNER)`. */
export const SIGNER = Symbol('Signer');
```

- [ ] **Step 7: Write the failing `EncryptedKeySigner` test**

`packages/api/src/signer/encrypted-key.signer.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { privateKeyToAddress } from 'viem/accounts';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../infra/prisma/prisma.service';
import { decrypt } from './aes-256-gcm';
import { EncryptedKeySigner } from './encrypted-key.signer';

const prismaMock = { wallet: { findUniqueOrThrow: vi.fn() } };
const MASTER = 'a'.repeat(64); // 32 bytes hex

describe('EncryptedKeySigner', () => {
  let signer: EncryptedKeySigner;

  beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = MASTER;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [EncryptedKeySigner, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    signer = moduleRef.get(EncryptedKeySigner);
  });

  it('createKey returns a valid address whose key decrypts back', async () => {
    const key = await signer.createKey();
    expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const privateKey = decrypt(key, Buffer.from(MASTER, 'hex')).toString('utf8');
    expect(privateKeyToAddress(privateKey as `0x${string}`)).toBe(key.address);
  });

  it('getAddress reads the stored address and never returns key material', async () => {
    prismaMock.wallet.findUniqueOrThrow.mockResolvedValue({ address: '0xabc' });
    await expect(signer.getAddress('w1')).resolves.toBe('0xabc');
  });

  it('fails fast when MASTER_ENCRYPTION_KEY is malformed', async () => {
    process.env.MASTER_ENCRYPTION_KEY = 'too-short';
    const moduleRef = await Test.createTestingModule({
      providers: [EncryptedKeySigner, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    expect(() => moduleRef.get(EncryptedKeySigner)).toThrow();
    process.env.MASTER_ENCRYPTION_KEY = MASTER;
  });
});
```
Note: `EncryptedKeySigner` constructor reads/validates the master key, so a malformed key throws when Nest instantiates the provider (`moduleRef.get`).

- [ ] **Step 8: Run it — verify it fails**

Run: `pnpm --filter @vencura/api exec vitest run src/signer/encrypted-key.signer.spec.ts`
Expected: FAIL — cannot find `./encrypted-key.signer`.

- [ ] **Step 9: Implement `EncryptedKeySigner`**

`packages/api/src/signer/encrypted-key.signer.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { PrismaService } from '../infra/prisma/prisma.service';
import { encrypt } from './aes-256-gcm';
import type { NewKey, Signer } from './signer';

/** Default custody model: the private key is AES-256-GCM-encrypted with the env
 *  master key and stored decomposed on the wallet row. Decrypted in memory only at
 *  sign time (T-012+), never logged, never returned by the API. */
@Injectable()
export class EncryptedKeySigner implements Signer {
  private readonly logger = new Logger(EncryptedKeySigner.name);
  private readonly masterKey: Buffer;

  constructor(private readonly prisma: PrismaService) {
    const hex = process.env.MASTER_ENCRYPTION_KEY ?? '';
    this.masterKey = Buffer.from(hex, 'hex');
    if (this.masterKey.length !== 32) {
      throw new Error('MASTER_ENCRYPTION_KEY must be 32 bytes of hex (64 hex chars)');
    }
  }

  async createKey(): Promise<NewKey> {
    const privateKey = generatePrivateKey();
    const address = privateKeyToAddress(privateKey);
    const envelope = encrypt(privateKey, this.masterKey);
    this.logger.log(`generated encrypted key for ${address}`);
    return { address, ...envelope };
  }

  async getAddress(walletId: string): Promise<string> {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: { address: true },
    });
    return wallet.address;
  }

  async signMessage(): Promise<string> {
    throw new Error('signMessage is implemented in T-012');
  }

  async signTransaction(): Promise<string> {
    throw new Error('signTransaction is implemented in T-017');
  }
}
```

- [ ] **Step 10: Wire `SignerModule`**

`packages/api/src/signer/signer.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EncryptedKeySigner } from './encrypted-key.signer';
import { SIGNER } from './signer';

// Exposes the Signer behind its DI token so consumers depend on the seam, not the impl.
@Module({
  providers: [{ provide: SIGNER, useClass: EncryptedKeySigner }],
  exports: [SIGNER],
})
export class SignerModule {}
```
Import `SignerModule` in `app.module.ts` (`imports: [PrismaModule, AuthModule, SignerModule, HealthModule]`).

- [ ] **Step 11: Run the signer suite — verify green**

Run: `pnpm --filter @vencura/api exec vitest run src/signer`
Expected: PASS.

- [ ] **Step 12: Verify gate**

Run: `pnpm --filter @vencura/api lint && pnpm --filter @vencura/api typecheck && pnpm --filter @vencura/api test && pnpm --filter @vencura/api build`
Expected: all green.

- [ ] **Step 13: Commit + DEVLOG**

```bash
git add -A && git commit -m "feat(api): Signer seam + EncryptedKeySigner (AES-256-GCM key custody) (T-008)"
```
DEVLOG entry: goal (custody centerpiece); mechanism (AES-256-GCM decomposed envelope, fresh IV, auth-tag verification, viem keypair gen, master key from env fail-fast, DI token seam, deferred sign methods); files; the `Signer` interface + `createKey` signature; tests (round-trip, tamper→throw, wrong-key→throw, address derivation); demo (the round-trip test output); gotchas (decrypt returns Buffer for future zeroization at sign time; sign methods throw until T-012/T-017). Commit DEVLOG: `git add DEVLOG.md && git commit -m "docs(devlog): T-008 entry"`.

---

## Task 3 — T-009: Create wallet endpoint

**Files:**
- Create: `packages/api/src/wallets/{wallets.module,wallets.controller,wallets.service}.ts`
- Test: `packages/api/src/wallets/{wallets.service,wallets.e2e}.spec.ts`
- Modify: `packages/api/src/app.module.ts`

- [ ] **Step 1: Write the failing `WalletsService` test**

`packages/api/src/wallets/wallets.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SIGNER } from '../signer/signer';
import { WalletsService } from './wallets.service';

const prismaMock = { wallet: { create: vi.fn(), findMany: vi.fn() } };
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
    expect(persisted).toMatchObject({ userId: 'user-1', encryptedPrivateKey: 'ct', encryptionAuthTag: 'tag' });
    expect(result).toEqual({ id: 'w1', address: '0xWALLET' });
    expect(JSON.stringify(result)).not.toContain('ct'); // no key material leaks
  });

  it('list is scoped to the requesting user', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'w1', address: '0xA', createdAt: new Date() }]);
    await service.list('user-1');
    expect(prismaMock.wallet.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'user-1' } });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @vencura/api exec vitest run src/wallets/wallets.service.spec.ts`
Expected: FAIL — cannot find `./wallets.service`.

- [ ] **Step 3: Implement `WalletsService`**

`packages/api/src/wallets/wallets.service.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SIGNER, type Signer } from '../signer/signer';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SIGNER) private readonly signer: Signer,
  ) {}

  async create(userId: string): Promise<{ id: string; address: string }> {
    const key = await this.signer.createKey();
    const wallet = await this.prisma.wallet.create({
      data: { userId, address: key.address, ...key }, // spreads address again harmlessly; envelope cols included
      select: { id: true, address: true },
    });
    this.logger.log(`wallet created: ${wallet.address} (user ${userId})`);
    return wallet;
  }

  list(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true, address: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```
Note: `key` is `{ address, encryptedPrivateKey, encryptionIv, encryptionAuthTag }`. `data: { userId, address: key.address, ...key }` — the explicit `address` and the spread agree; alternatively spread `...key` alone (it already contains `address`). Keep `data: { userId, ...key }` for clarity and drop the redundant `address:` line:
```ts
data: { userId, ...key },
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @vencura/api exec vitest run src/wallets/wallets.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement controller + module**

`packages/api/src/wallets/wallets.controller.ts`:
```ts
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  create(@CurrentUser() user: { id: string }) {
    return this.wallets.create(user.id);
  }

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.wallets.list(user.id);
  }
}
```

`packages/api/src/wallets/wallets.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignerModule } from '../signer/signer.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [AuthModule, SignerModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
```
Import `WalletsModule` in `app.module.ts` (`imports: [PrismaModule, AuthModule, SignerModule, WalletsModule, HealthModule]`).

- [ ] **Step 6: Write the HTTP e2e test (auth required)**

`packages/api/src/wallets/wallets.e2e.spec.ts`:
```ts
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({ imports: [WalletsModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(SIGNER)
      .useValue(signerMock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    token = app.get(JwtService).sign({ sub: 'user-1', email: 'a@b.com' });
  });

  afterAll(async () => app.close());

  it('rejects an unauthenticated create with 401', async () => {
    expect((await request(app.getHttpServer()).post('/wallets')).status).toBe(401);
  });

  it('creates a wallet for the authed user and returns only id + address', async () => {
    prismaMock.wallet.create.mockResolvedValue({ id: 'w1', address: '0xWALLET' });
    const res = await request(app.getHttpServer()).post('/wallets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'w1', address: '0xWALLET' });
    expect(JSON.stringify(res.body)).not.toContain('ct');
  });
});
```

- [ ] **Step 7: Run the wallets suite — verify green**

Run: `pnpm --filter @vencura/api exec vitest run src/wallets`
Expected: PASS.

- [ ] **Step 8: Verify gate**

Run: `pnpm --filter @vencura/api lint && pnpm --filter @vencura/api typecheck && pnpm --filter @vencura/api test && pnpm --filter @vencura/api build`
Expected: all green.

- [ ] **Step 9: Commit + DEVLOG**

```bash
git add -A && git commit -m "feat(api): create-wallet endpoint — POST/GET /wallets (T-009)"
```
DEVLOG entry: goal (custodial wallet creation); mechanism (guarded routes, Signer.createKey → persist envelope → return address only, owner-scoped list); files; `create`/`list` signatures; tests (no key leak, owner scoping, 401 unauth); demo (curl with bearer token); gotchas (returns id+address only; envelope never serialized). Commit DEVLOG.

---

## Task 4 — T-010: Admin web shell + auth + create-wallet UI

> **Mode = scaffold + UI.** No failing-test-first; the bar is a working browser flow plus green lint/typecheck/build (§13). Keep `test` as `--passWithNoTests`.

**Files:**
- Modify: `packages/web/package.json`, `packages/web/tsconfig.json`
- Create: `packages/web/index.html`, `packages/web/vite.config.ts`, `packages/web/src/{main.tsx,App.tsx,api.ts,auth-context.tsx}`
- Delete: `packages/web/src/index.ts`, `packages/web/dist/`, `packages/web/tsconfig.build.json` (lib-only)

- [ ] **Step 1: Install React + Vite**

```bash
pnpm --filter @vencura/web add react react-dom
pnpm --filter @vencura/web add -D vite @vitejs/plugin-react @types/react @types/react-dom
rm -rf packages/web/dist packages/web/src/index.ts packages/web/tsconfig.build.json
```

- [ ] **Step 2: Update `package.json` scripts**

`packages/web/package.json` — set `scripts` to:
```json
{
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run --passWithNoTests"
  }
}
```

- [ ] **Step 3: Vite config + tsconfig (JSX)**

`packages/web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxy /api → Nest (port 3000) so the SPA and API share an origin in dev.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } } },
});
```
`packages/web/tsconfig.json` — ensure `compilerOptions` include `"jsx": "react-jsx"`, `"lib": ["DOM","DOM.Iterable","ES2022"]`, `"moduleResolution": "Bundler"`, `"noEmit": true`, and `"include": ["src"]` (extend `../../tsconfig.base.json` as the other packages do).

- [ ] **Step 4: HTML entry + React bootstrap**

`packages/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VenCura Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
`packages/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 5: Typed API client**

`packages/web/src/api.ts`:
```ts
const TOKEN_KEY = 'vencura.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function call<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth) headers.Authorization = `Bearer ${tokenStore.get() ?? ''}`;
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface AuthResult { accessToken: string; user: { id: string; email: string } }
export interface Wallet { id: string; address: string; createdAt?: string }

export const api = {
  register: (email: string, password: string) =>
    call<AuthResult>('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) =>
    call<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }),
  createWallet: () => call<Wallet>('/wallets', { method: 'POST', auth: true }),
  listWallets: () => call<Wallet[]>('/wallets', { auth: true }),
};
```

- [ ] **Step 6: Auth context + App (login/register + create-wallet + list)**

`packages/web/src/auth-context.tsx`:
```tsx
import { createContext, type ReactNode, useContext, useState } from 'react';
import { api, tokenStore } from './api';

interface AuthCtx {
  email: string | null;
  authenticate: (mode: 'login' | 'register', email: string, password: string) => Promise<void>;
  logout: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const authenticate = async (mode: 'login' | 'register', e: string, p: string) => {
    const res = await api[mode](e, p);
    tokenStore.set(res.accessToken);
    setEmail(res.user.email);
  };
  const logout = () => {
    tokenStore.clear();
    setEmail(null);
  };
  return <Ctx.Provider value={{ email, authenticate, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
```

`packages/web/src/App.tsx`:
```tsx
import { type FormEvent, useState } from 'react';
import { api, type Wallet } from './api';
import { AuthProvider, useAuth } from './auth-context';

function AuthForm() {
  const { authenticate } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await authenticate(mode, email, password);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit}>
      <h1>VenCura Admin</h1>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">{mode}</button>
      <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        switch to {mode === 'login' ? 'register' : 'login'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function Dashboard() {
  const { email, logout } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const refresh = async () => setWallets(await api.listWallets());
  const create = async () => {
    await api.createWallet();
    await refresh();
  };
  return (
    <div>
      <header>
        <span>{email}</span> <button onClick={logout}>logout</button>
      </header>
      <button onClick={create}>Create wallet</button>
      <button onClick={refresh}>Refresh</button>
      <ul>
        {wallets.map((w) => (
          <li key={w.id}>
            <code>{w.address}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shell() {
  const { email } = useAuth();
  return email ? <Dashboard /> : <AuthForm />;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
```

- [ ] **Step 7: Verify gate + manual browser flow**

Run: `pnpm --filter @vencura/web lint && pnpm --filter @vencura/web typecheck && pnpm --filter @vencura/web build`
Expected: all green.
Then manually: ensure infra is up (`pnpm bootstrap` if needed), run `pnpm --filter @vencura/api dev` and `pnpm --filter @vencura/web dev`, open `http://localhost:5173`, register → see the dashboard → click **Create wallet** → a `0x…` address appears. Capture this for the DEVLOG.

- [ ] **Step 8: Commit + DEVLOG + Block recap**

```bash
git add -A && git commit -m "feat(web): admin shell — auth + create-wallet UI (T-010)"
```
DEVLOG entry: goal (load-bearing admin); mechanism (Vite+React SPA, /api dev proxy, localStorage token, typed fetch client, register/login + create/list wallets); files; demo (the browser flow + screenshot/text of the created address); gotchas (localStorage token = documented XSS tradeoff for the demo, revisit in T-036; web `test` stays `--passWithNoTests`).
Then append the **Block 2 recap** (§12): what shipped (auth, custody core, wallet creation, admin), version **v0.2.0**, how to demo. Commit DEVLOG.

- [ ] **Step 9: Confirm CI green + version bump**

Push is continuous to `main`; after the last commit, confirm GitHub Actions is green and semantic-release cut **`v0.2.0`** (the `feat:` commits drive the minor bump). Run: `gh run list --branch main --limit 3` and `git fetch --tags && git tag -l "v0.2.*"`.

---

## Self-Review (against the spec)

**Spec coverage:** T-007 (Task 1: register/login, argon2, JWT, zod, guard, no-enumeration) ✓ · T-008 (Task 2: AES-256-GCM helper, Signer seam + token, createKey, getAddress, deferred sign methods, fail-fast master key) ✓ · T-009 (Task 3: POST/GET /wallets, returns address only, owner-scoped, 401) ✓ · T-010 (Task 4: Vite+React, auth UI, create-wallet, wallet list) ✓ · Validation-in-shared via nestjs-zod (Task 1 Steps 2–4) ✓ · Logs at demo points (registered/login/wallet created) ✓ · Scope guards honored (no global filter, no signMessage impl, no schema migration) ✓.

**Placeholder scan:** every code step contains complete code; every run step has an exact command + expected result; no TBD/"similar to". ✓

**Type consistency:** `EncryptedEnvelope` fields (`encryptedPrivateKey`/`encryptionIv`/`encryptionAuthTag`) used identically in `aes-256-gcm.ts`, `NewKey`, `EncryptedKeySigner.createKey`, the wallet `data` spread, and all mocks; `Signer` method names match between `signer.ts`, the impl, and the `SIGNER`-injected consumer; `AuthResult` shape (`accessToken`, `user`) matches between `AuthService`, the e2e test, and the web `api.ts`. ✓
