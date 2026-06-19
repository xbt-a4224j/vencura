import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

// @Global: any feature (policy, wallets, transactions) injects EventsService to emit/record
// without re-importing. AuthModule is imported so the controller's JwtAuthGuard resolves.
@Global()
@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
