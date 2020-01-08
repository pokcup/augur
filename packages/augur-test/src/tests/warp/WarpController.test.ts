import { ContractAddresses } from '@augurproject/artifacts';
import { NetworkId } from '@augurproject/artifacts/build';
import { DB } from '@augurproject/sdk/build/state/db/DB';
import { LogFilterAggregator } from '@augurproject/sdk/build/state/logs/LogFilterAggregator';
import { BulkSyncStrategy } from '@augurproject/sdk/build/state/sync/BulkSyncStrategy';
import { WarpSyncStrategy } from '@augurproject/sdk/build/state/sync/WarpSyncStrategy';
import { configureDexieForNode } from '@augurproject/sdk/build/state/utils/DexieIDBShim';
import { WarpController } from '@augurproject/sdk/build/warp/WarpController';
import {
  ACCOUNTS,
  loadSeedFile,
  makeDependencies,
  makeSigner,
} from '@augurproject/tools';
import { ContractAPI } from '@augurproject/tools/build';
import { ContractDependenciesEthers } from 'contract-dependencies-ethers';
import * as IPFS from 'ipfs';
import { makeDbMock, makeProvider } from '../../libs';
import { TestEthersProvider } from '../../libs/TestEthersProvider';
import { API } from "@augurproject/sdk/build/state/getter/API";

const mock = makeDbMock();

describe('WarpController', () => {
  let addresses: ContractAddresses;
  let db:DB;
  let dependencies: ContractDependenciesEthers;
  let ipfs;
  let john: ContractAPI;
  let mary: ContractAPI;
  let networkId:NetworkId;
  let provider: TestEthersProvider;
  let warpController: WarpController;
  let fileHash: string;

  beforeAll(async () => {
    configureDexieForNode(true);
    ipfs = await IPFS.create();

    const seed = await loadSeedFile('/tmp/newSeed.json');

    provider = await makeProvider(seed, ACCOUNTS);
    networkId = await provider.getNetworkId();
    const signer = await makeSigner(ACCOUNTS[0], provider);
    dependencies = makeDependencies(ACCOUNTS[0], provider, signer);
    addresses = seed.addresses;

    john = await ContractAPI.userWrapper(ACCOUNTS[0], provider, seed.addresses);
    mary = await ContractAPI.userWrapper(ACCOUNTS[0], provider, seed.addresses);

    db = await mock.makeDB(john.augur, ACCOUNTS);

    const bulkSyncStrategy = new BulkSyncStrategy(
      provider.getLogs,
      db.logFilters.buildFilter,
      db.logFilters.onLogsAdded,
      john.augur.contractEvents.parseLogs
    );

    // populate db.
    await bulkSyncStrategy.start(0, await provider.getBlockNumber());

    warpController = new WarpController(db, ipfs);
    fileHash = await warpController.createAllCheckpoints();
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
    describe('top-level directory', () => {
      test('should have a version file with the version number', async () => {
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
    // This is a spot check.
    test('should have some logs', async () => {
      const marketCreated = await ipfs.cat(`${fileHash}/tables/MarketCreated/index`);
      const splitLogs = marketCreated.toString().
        split('\n').
        filter((log) => log).
        map((log) => {
          try {
            return JSON.parse(log);
          } catch (e) {
            console.error(e, log);
          }
        });

      expect(splitLogs).toEqual(await db.MarketCreated.toArray());
    });
  });

  describe('full sync', () => {
    test('should populate market data', async () => {
      const maryDB = await mock.makeDB(mary.augur, ACCOUNTS);
      const maryWarpController = new WarpController(maryDB, ipfs);
      const maryApi  = new API(mary.augur, Promise.resolve(maryDB));

      const warpSyncStrategy = new WarpSyncStrategy(
        maryWarpController,
        maryDB.logFilters.onLogsAdded,
      );

      // populate db.
      await warpSyncStrategy.start(fileHash);

      const johnApi  = new API(john.augur, Promise.resolve(db));
      const johnMarketList = await johnApi.route('getMarkets', {
        universe: addresses.Universe
      });

      const maryMarketList = await maryApi.route('getMarkets', {
        universe: addresses.Universe
      });

      expect(maryMarketList).toEqual(johnMarketList);
    });
  });

  describe('warp sync checkpoint', () => {
    test('should ', async () => {

      
    });
  });
});
