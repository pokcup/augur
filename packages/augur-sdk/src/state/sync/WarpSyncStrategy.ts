import { Log } from '@augurproject/types';
import { WarpController } from '../../warp/WarpController';
import _ from 'lodash';

export class WarpSyncStrategy {
  constructor(
    protected warpSyncController:WarpController,
    protected onLogsAdded: (blockNumber: number, logs: Log[]) => Promise<void>) {
  }

  async start(ipfsRootHash?: string): Promise<number | undefined> {
    console.log('Hello', ipfsRootHash);
    // No hash, nothing to do!
    if (!ipfsRootHash) return undefined;

    const allLogs = await this.warpSyncController.getFile(
      'QmThtLf1Qho9JpnnFig71VMUBgPQLbxSdjRs7Hbh7xVJLu/index');
    const splitLogs = allLogs.toString().
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
        console.log(Number(blockNumber), groupedLogs[blockNumber]);
        await this.onLogsAdded(Number(blockNumber), groupedLogs[blockNumber]);
      }
    }

    return _.maxBy<number>(splitLogs, (item) => Number(item['blockNumber']));
  }
}
