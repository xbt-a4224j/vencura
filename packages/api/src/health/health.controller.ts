import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

/** Liveness endpoint — used by deploy platforms, CI smoke checks, and the demo. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'The API process is up and serving requests.' })
  check() {
    return {
      status: 'ok',
      service: 'vencura-api',
      timestamp: new Date().toISOString(),
    };
  }
}
