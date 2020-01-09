import { Log } from '@augurproject/types';
import { WarpController } from '../../warp/WarpController';
import _ from 'lodash';
import { Address } from '../logs/types';

export class WarpSyncStrategy {
  constructor(
    protected warpSyncController:WarpController,
    protected onLogsAdded: (blockNumber: number, logs: Log[]) => Promise<void>) {
  }

  async syncMarket(ipfsRootHash?: string, marketId?: Address) {
    // No hash, nothing to do!
    if (!ipfsRootHash) return undefined;

    // No marketId, nothing to do!
    if (!marketId) return undefined;

    const marketLogs = await this.warpSyncController.getFile(
      `${ipfsRootHash}/market/${marketId}`);

    return this.processFile(marketLogs);
  }

  async start(ipfsRootHash?: string): Promise<number | undefined> {
    // No hash, nothing to do!
    if (!ipfsRootHash) return undefined;

    const allLogs = await this.warpSyncController.getFile(
      `${ipfsRootHash}/index`);

    return this.processFile(allLogs);
  }

  async processFile(buffer: Buffer): Promise<number | undefined> {
    const splitLogs = buffer.toString().
      split('\n').
      filter((log) => log).
      map((log) => {
        try {
          return JSON.parse(log);
        } catch (e) {
          console.error(e, log);
        }
      });

    const groupedLogs = _.groupBy(splitLogs, 'blockNumber');
    for (const blockNumber in groupedLogs) {
      if (groupedLogs.hasOwnProperty(blockNumber)) {
        try {
          await this.onLogsAdded(Number(blockNumber), groupedLogs[blockNumber])
        } catch (e) {
          console.log(JSON.stringify(Number(blockNumber), groupedLogs[blockNumber]))
        };
      }
    }

    return _.maxBy<number>(splitLogs, (item) => Number(item['blockNumber']));
  }
}
