import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { EventsService } from './events.service';

// The live "system log" the Activity tab tails: a bounded ring of operational lines polled with a
// `?after=<seq>` cursor. Auth-guarded — the log narrates the operator's own session, not public.
@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  since(@Query('after') after?: string) {
    const cursor = Number(after);
    return this.events.since(Number.isFinite(cursor) && cursor > 0 ? cursor : 0);
  }
}
