import Dexie from 'dexie';
import * as IPFS from 'ipfs';
import * as Unixfs from 'ipfs-unixfs';
import { DAGNode } from 'ipld-dag-pb';

import { DB } from '../state/db/DB';
import { OrderEventType } from '../state/logs/types';
import _ from 'lodash';

export const WARPSYNC_VERSION = '1';

type NameOfType<T, R> = {
  [P in keyof T]: T[P] extends R ? P : never;
}[keyof T];

type AllDBNames = NameOfType<DB, Dexie.Table<any, any>>;

interface IPFSObject {
  Hash: string;
  Size: string;
}

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
    topLevelDirectory.addLink(
      await this.buildDirectory('market', await this.createMarketFolders())
    );

    let indexFileLinks = [];

    const tableNode = new DAGNode(Unixfs.default('directory').marshal());
    for (const table of this.db.databasesToSync()) {
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

    console.log('checkpoint', d.toString());
    return d.toString();
  }

  async addDBToIPFS(table: Dexie.Table<any, any>) {
    const results = await this.ipfsAddRows(await table.toArray());

    const file = Unixfs.default('file');
    for (let i = 0; i < results.length; i++) {
      file.addBlockSize(results[i].Size);
    }
    const links = [];
    const indexFile = new DAGNode(file.marshal());
    for (let i = 0; i < results.length; i++) {
      const link = results[i];
      links.push(link);
      indexFile.addLink(link);
    }

    const indexFileResponse = await this.ipfs.dag.put(
      indexFile,
      WarpController.DEFAULT_NODE_TYPE
    );

    const directory = Unixfs.default('directory');
    for (let i = 0; i < results.length; i++) {
      directory.addBlockSize(results[i].Size);
    }

    directory.addBlockSize(file.fileSize());
    const directoryNode = new DAGNode(directory.marshal());
    for (let i = 0; i < results.length; i++) {
      directoryNode.addLink({
        Name: `file${i}`,
        Hash: results[i].Hash,
        Size: results[i].Size,
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
    const file = Unixfs.default('file');
    const directory = Unixfs.default('directory');
    for (let i = 0; i < items.length; i++) {
      directory.addBlockSize(items[i].size);
    }

    directory.addBlockSize(file.fileSize());
    const directoryNode = new DAGNode(directory.marshal());

    for (let i = 0; i < items.length; i++) {
      await directoryNode.addLink(items[i]);
    }

    const q = await this.ipfs.dag.put(
      directoryNode,
      WarpController.DEFAULT_NODE_TYPE
    );

    return {
      Name: name,
      Hash: q.toString(),
      Size: 0,
    };
  }

  private async ipfsAddRows(rows: any[]): Promise<IPFSObject[]> {
    if (_.isEmpty(rows)) {
      return [];
    }

    const requests = rows.map((row, i) => ({
      content: Buffer.from(JSON.stringify(row) + '\n'),
    }));

    const data = await this.ipfs.add(requests);
    return data.map(item => ({
      Hash: item.hash,
      Size: item.size,
    }));
  }

  async createMarketFolders() {
    const dbNamesToSync = [
      'MarketCreated',
      'MarketVolumeChanged',
      'MarketOIChanged',
      'InitialReportSubmitted',
      'DisputeCrowdsourcerCompleted',
      'MarketFinalized',
      'MarketParticipantsDisavowed',
      'MarketMigrated',
      'OrderEvent',
    ] as const;

    const result = (await this.db.MarketCreated.toArray()).map(
      async ({ market }) => {
        const items = _.flatten(await Promise.all(
          dbNamesToSync.map(dbName => this.createLogFile(dbName, market))
        ));

        const file = Unixfs.default('file');
        for (let i = 0; i < items.length; i++) {
          file.addBlockSize(items[i].Size);
        }

        const indexFile = new DAGNode(file.marshal());
        for (let i = 0; i < items.length; i++) {
          const link = items[i];
          indexFile.addLink(link);
        }

        const indexFileResponse = await this.ipfs.dag.put(
          indexFile,
          WarpController.DEFAULT_NODE_TYPE
        );

        return {
          Name: market,
          Hash: indexFileResponse.toString(),
          Size: file.fileSize(),
        }
      }
    );

    return Promise.all(result);
  }

  async createLogFile(dbName: AllDBNames, marketId: string) {
    const logs = await this.db[dbName]
      .where('market')
      .equals(marketId)
      .toArray();

    return this.ipfsAddRows(logs);
  }

  getFile(ipfsPath: string) {
    return this.ipfs.cat(ipfsPath);
  }
}
