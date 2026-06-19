import { Injectable } from '@nestjs/common';

@Injectable()
export class PollingStateService {
  private live = false;
  isLive(): boolean { return this.live; }
  setLive(v: boolean): void { this.live = v; }
}
