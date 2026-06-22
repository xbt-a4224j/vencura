import { Module } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';

// ChainService is provided by the @Global ChainModule, so no import needed here.
@Module({
  providers: [DiagnosticsService],
})
export class DiagnosticsModule {}
