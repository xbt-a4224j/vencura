import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ChainService } from './chain.service';

/** Live chain head — block height + gas price — for the UI status bar / "heartbeat".
 *  Public chain data, so unauthenticated; cheap two-call read off the RPC. */
@ApiTags('chain')
@Controller('chain')
export class ChainController {
  constructor(private readonly chain: ChainService) {}

  @Get('head')
  @ApiOkResponse({ description: 'Current Sepolia block number + gas price (gwei).' })
  async head() {
    const [blockNumber, gasPrice] = await Promise.all([this.chain.getBlockNumber(), this.chain.getGasPrice()]);
    return {
      network: 'sepolia',
      blockNumber: Number(blockNumber),
      gasGwei: Math.round(Number(gasPrice) / 1e7) / 100, // wei → gwei, 2 dp
    };
  }
}
