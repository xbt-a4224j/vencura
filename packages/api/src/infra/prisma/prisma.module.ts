import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so feature modules inject PrismaService without re-importing (it's infra, §6.1).
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
