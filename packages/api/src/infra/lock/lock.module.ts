import { Global, Module } from '@nestjs/common';
import { LOCK } from './lock';
import { PgAdvisoryLock } from './pg-advisory-lock';

@Global()
@Module({
  providers: [{ provide: LOCK, useClass: PgAdvisoryLock }],
  exports: [LOCK],
})
export class LockModule {}
