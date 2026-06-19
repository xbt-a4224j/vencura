import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LogLine {
  seq: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

// One event source, two sinks (the design behind the Activity tab's two subviews):
//   • emit()   → ephemeral ring buffer only — the live "system log" the UI tails (GET /events).
//   • record() → durable `audit_log` row + the ring — the queryable audit trail (GET /activity).
// The ring is in-memory and bounded; it lives in the long-running API process (Railway), so a
// `?after=seq` poll is a reliable scrolling log without SSE through the Vercel rewrite.
@Injectable()
export class EventsService {
  private readonly buffer: LogLine[] = [];
  private seq = 0;
  private static readonly CAP = 200;

  constructor(private readonly prisma: PrismaService) {}

  /** Push an ephemeral operational line (policy pass, nonce acquired, broadcast…) to the ring. */
  emit(msg: string, level: LogLine['level'] = 'info'): LogLine {
    const line: LogLine = { seq: ++this.seq, at: new Date().toISOString(), level, msg };
    this.buffer.push(line);
    if (this.buffer.length > EventsService.CAP) this.buffer.shift();
    return line;
  }

  /** Persist a governance action to `audit_log` AND surface it on the live ring. */
  async record(e: {
    userId: string;
    walletId?: string;
    type: string;
    detail?: unknown;
    msg: string;
    level?: LogLine['level'];
  }): Promise<void> {
    this.emit(e.msg, e.level);
    await this.prisma.auditLog.create({
      data: {
        userId: e.userId,
        walletId: e.walletId ?? null,
        type: e.type,
        detail: (e.detail ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  /** The live system log tail: every line with seq strictly greater than `after`, plus the head seq
   *  so the client can advance its cursor (and detect a buffer rollover when seq jumps). */
  since(after = 0): { lines: LogLine[]; seq: number } {
    return { lines: this.buffer.filter((l) => l.seq > after), seq: this.seq };
  }
}
