import Dexie from 'dexie';
import * as IPFS from 'ipfs';

import { SyncableInterface } from '../state/types';
import { WarpController } from './WarpController';
import { configureDexieForNode } from '../state/utils/DexieIDBShim';

interface TableOneInterface {
  id?: number;
  key1: string;
  key2: string;
}

interface TableTwoInterface {
  id?: number;
  key1: string;
  key2: string;
}

class FakeDB extends Dexie implements SyncableInterface {
  tableOne: Dexie.Table<TableOneInterface, string>;
  tableTwo: Dexie.Table<TableTwoInterface, string>;

  constructor() {
    super('MyAppDatabase');
    this.version(1).stores({
      tableOne: '++id, key1, key2',
      tableTwo: '[blockNumber+logIndex], key2, key3',
    });

    this.tableOne = this.table('tableOne');
    this.tableTwo = this.table('tableTwo');
  }

  databasesToSync(): Dexie.Table<any, any>[] {
    return [this.tableOne, this.tableTwo];
  }

  async getSyncStartingBlock(): Promise<number> {
    return 1234;
  }

  async rollback(blockNumber: number): Promise<void> {}
}

describe('WarpController', () => {
  let fakeDB;
  let ipfs;
  let warpController: WarpController;

  beforeAll(async () => {
    configureDexieForNode(true);
    ipfs = await IPFS.create();
  });

  beforeEach(async () => {
    fakeDB = new FakeDB();
    warpController = new WarpController(fakeDB, ipfs);
  });

  afterAll(async () => {
    await ipfs.stop();
  });

  /*
    # From https://gist.github.com/pgebheim/3f2faae37f29f8e22d4bf4d5a0c6dbab
    - ${warppoint}/                             # ROOT hash for each warp sync there will be a unique hash
      - version                                 # Format Version, clients can use this to determine whether or not they're compatiable with the warp sync format.
      - index                                   # A serialized form of all content suitable for a new client getting all information
      - checkpoints/                            # A directory holding historical checkpoints, this can be capped at N checkpoints.
        - ${checkpoint_blocknumber}             # A directory holding data for a checkpoint as of a blocknumber
          - index                               # All checkpoint data in a serialized form consumable for clients that just need that checkpoint
      - events (Rename to tables)               # A directory containing serialized forms of each table
        - CompleteSetsPurchased
        - CompleteSetsSold
        - DisputeCrowdsourcerCompleted
        - ... MORE
        - TransferBatch
      - market/                               # A directory containing market rollups
        - volume                              # All market volumes
        - oi                                  # All market OIs
        - ${market_id}/
          - orders                            # Orders filtered by a market
      - token/                                # A directory containing token rollups
        - balance                             # Balances for all owner,token
      - share_token/                          # A directory containing share token rollups
        - balance                             # Balances for all [account, marketid, outcome]
      - account/${account_id}                 # Indexed lookups for an account
        - orders
        - pnl
        - market/${market_id}                 # indexed lookups for a market within an account
          - orders
          - pnl
  **/
  describe('empty database', () => {
    let fileHash: string;
    beforeEach(async () => {
      fileHash = await warpController.createAllCheckpoints();
    });

    describe('top-level directory', async () => {
      test('should have a version file with the version number', async () => {
        const resp = await ipfs.cat(`${fileHash}/VERSION`);

        await expect(ipfs.cat(`${fileHash}/VERSION`)).resolves.toEqual(Buffer.from('1'));
      });

      test('should have the prescribed layout', async () => {
        await expect(ipfs.ls(`${fileHash}`)).resolves.toEqual([
          expect.objectContaining({
            name: 'VERSION',
            type: 'file',
          }),
          expect.objectContaining({
            name: 'index',
            type: 'file',
          }),
          expect.objectContaining({
            name: 'accounts',
            type: 'dir',
          }),
          expect.objectContaining({
            name: 'checkpoints',
            type: 'dir',
          }),
          expect.objectContaining({
            name: 'tables',
            type: 'dir',
          }),
        ]);
      });
    });
  });

  describe('non-empty dbs', () => {
    test('with some logs', async () => {



    });
  });

});
