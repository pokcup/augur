import Dexie from 'dexie';
import * as IPFS from 'ipfs';
import * as Unixfs from 'ipfs-unixfs';
import { DAGNode } from 'ipld-dag-pb';

import { DB } from '../state/db/DB';
import { OrderEventType } from '../state/logs/types';

export const WARPSYNC_VERSION = '1';

export class WarpController {
  private static DEFAULT_NODE_TYPE = { format: 'dag-pb', hashAlg: 'sha2-256' };
  get ready() {
    return this.ipfs.ready;
  }

  static async create(db: DB) {
    const ipfs = await IPFS.create();
    return new WarpController(db, ipfs);
  }

  constructor(private db: DB, private ipfs: IPFS) {}

  async createAllCheckpoints() {
    const topLevelDirectory = new DAGNode(
      Unixfs.default('directory').marshal()
    );
    const versionFile = await this.ipfs.add({
      content: Buffer.from(WARPSYNC_VERSION),
    });
    topLevelDirectory.addLink({
      Name: 'VERSION',
      Hash: versionFile[0].hash,
      Size: 1,
    });

    topLevelDirectory.addLink(await this.buildDirectory('accounts'));
    topLevelDirectory.addLink(await this.buildDirectory('checkpoints'));
    topLevelDirectory.addLink(await this.buildDirectory('market', await this.createMarketFolders()));

    let indexFileLinks = [];

    const tableNode = new DAGNode(Unixfs.default('directory').marshal());
    for (const table of this.db.databasesToSync()) {
      console.log(`Syncing ${table.name} ${(await table.toArray()).length}`);
      const [links, r] = await this.addDBToIPFS(table);
      indexFileLinks = [...indexFileLinks, ...links];
      tableNode.addLink(r);
    }
    topLevelDirectory.addLink({
      Name: 'tables',
      Hash: await this.ipfs.dag.put(
        tableNode,
        WarpController.DEFAULT_NODE_TYPE
      ),
      Size: 0,
    });

    const file = Unixfs.default('file');
    for (let i = 0; i < indexFileLinks.length; i++) {
      file.addBlockSize(indexFileLinks[i].Size);
    }

    const indexFile = new DAGNode(file.marshal());
    for (let i = 0; i < indexFileLinks.length; i++) {
      indexFile.addLink(indexFileLinks[i]);
    }

    const indexFileResponse = await this.ipfs.dag.put(
      indexFile,
      WarpController.DEFAULT_NODE_TYPE
    );
    topLevelDirectory.addLink({
      Name: 'index',
      Hash: indexFileResponse,
      Size: file.fileSize(),
    });

    const d = await this.ipfs.dag.put(
      topLevelDirectory,
      WarpController.DEFAULT_NODE_TYPE
    );

    console.log(d.toString());
    return d.toString();
  }

  async addDBToIPFS(table: Dexie.Table<any, any>) {
    const results = await this.ipfsAddRows(await table.toArray());

    const file = Unixfs.default('file');
    for (let i = 0; i < results.length; i++) {
      file.addBlockSize(results[i].size);
    }
    const links = [];
    const indexFile = new DAGNode(file.marshal());
    for (let i = 0; i < results.length; i++) {
      const link = {
        Hash: results[i].hash,
        Size: results[i].size,
      };
      links.push(link);
      indexFile.addLink(link);
    }

    const indexFileResponse = await this.ipfs.dag.put(
      indexFile,
      WarpController.DEFAULT_NODE_TYPE
    );

    const directory = Unixfs.default('directory');
    for (let i = 0; i < results.length; i++) {
      // directory.addBlockSize(results[i].size);
    }

    // directory.addBlockSize(file.fileSize());
    const directoryNode = new DAGNode(directory.marshal());
    for (let i = 0; i < results.length; i++) {
      directoryNode.addLink({
        Name: `file${i}`,
        Hash: results[i].hash,
        Size: results[i].size,
      });
    }

    directoryNode.addLink({
      Name: 'index',
      Hash: indexFileResponse.toString(),
      Size: file.fileSize(),
    });

    const q = await this.ipfs.dag.put(
      directoryNode,
      WarpController.DEFAULT_NODE_TYPE
    );
    return [
      links,
      {
        Name: table.name,
        Hash: q.toString(),
        Size: 0,
      },
    ];
  }

  private async buildDirectory(name: string, items = []) {
    const directoryNode = new DAGNode(Unixfs.default('directory').marshal());

    console.log('items', JSON.stringify(items));

    for (let i = 0; i < items.length; i++) {
      await directoryNode.addLink(items[i]);
    }

    const result = await this.ipfs.dag.put(
      directoryNode,
      WarpController.DEFAULT_NODE_TYPE
    );
    return {
      Name: `${name}`,
      Hash: result,
      Size: 0,
    };
  }

  private async ipfsAddRows(
    rows: any[]
  ): Promise<{ hash: string; size: string }[]> {
    return this.ipfs.add(
      rows.map((row, i) => ({
        content: Buffer.from(JSON.stringify(row) + '\n'),
      }))
    );
  }

  async createMarketFolders() {
    const result = (await this.db.MarketCreated.toArray()).map(async (market) => {
      const marketOrders = await this.createMarketOrders(market.market);
      return this.buildDirectory(market.market, marketOrders)
    });

    return Promise.all(result);
  }

  async createMarketOrders(marketId: string) {
    const orderEvents = await this.db.OrderEvent.where('[market+eventType]')
      .equals([marketId, OrderEventType.Fill])
      .toArray();
    return this.ipfsAddRows(orderEvents);
  }

  getFile(ipfsPath: string) {
    return this.ipfs.cat(ipfsPath);
  }
}
