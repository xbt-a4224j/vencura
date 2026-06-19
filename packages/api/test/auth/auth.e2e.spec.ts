import { Controller, Get, type INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { EventsModule } from '@/infra/events/events.module';
import { AuthModule } from '@/auth/auth.module';
import { CurrentUser } from '@/auth/current-user.decorator';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';

// A throwaway protected route to prove the guard accepts/rejects tokens.
@Controller('protected')
class ProbeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  whoami(@CurrentUser() user: { id: string }) {
    return user;
  }
}

const prismaMock = { user: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } };

describe('Auth HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, EventsModule, AuthModule],
      controllers: [ProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
  });

  afterAll(async () => app?.close());

  it('rejects invalid registration input with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'nope', password: 'x' });
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
