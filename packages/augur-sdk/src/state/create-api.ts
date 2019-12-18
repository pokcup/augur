import { Augur } from '../Augur';
import { BlockAndLogStreamerListener } from './db/BlockAndLogStreamerListener';
import { ContractDependenciesGnosis } from 'contract-dependencies-gnosis';
import { Controller } from './Controller';
import { EthersProvider } from '@augurproject/ethersjs-provider';
import { JsonRpcProvider } from 'ethers/providers';
import { EmptyConnector } from '../connector/empty-connector';
import { Addresses, UploadBlockNumbers } from '@augurproject/artifacts';
import { API } from './getter/API';
import { DB } from './db/DB';
import { GnosisRelayAPI } from '@augurproject/gnosis-relay-api';
import { WSClient } from '@0x/mesh-rpc-client';

const settings = require('./settings.json');

async function buildDeps(ethNodeUrl: string, account?: string, enableFlexSearch = false) {
  console.log('buildDeps is called');
  const ethersProvider = new EthersProvider(new JsonRpcProvider(ethNodeUrl), 10, 0, 40);
  const networkId = await ethersProvider.getNetworkId();
  const gnosisRelay = new GnosisRelayAPI(settings.gnosisRelayURLs[networkId]);
  console.log('networkId', networkId);
  const contractDependencies = new ContractDependenciesGnosis(ethersProvider, gnosisRelay, undefined, undefined, undefined, undefined, account);

  try {
    console.log('create mesh client');
    let meshClient = undefined;
    try {
      meshClient = new WSClient(settings.meshBrowserURLs[networkId]);
    } catch(e) {
      console.log('create client', e);
    }

    console.log('mesh client created');
    const augur = await Augur.create(ethersProvider, contractDependencies, Addresses[networkId], new EmptyConnector(), undefined, enableFlexSearch, meshClient, undefined);
    const blockAndLogStreamerListener = BlockAndLogStreamerListener.create(ethersProvider, augur.events.getEventTopics, augur.events.parseLogs, augur.events.getEventContractAddress);
    console.log('augur.zeroX in create-api', !!augur.zeroX);
    const db = DB.createAndInitializeDB(
      Number(networkId),
      settings.blockstreamDelay,
      UploadBlockNumbers[networkId],
      augur,
      blockAndLogStreamerListener
    );

    return { augur, blockAndLogStreamerListener, db };

  }catch(e) {
    console.log('build dep error', e);
  }
return null;
}

export async function create(ethNodeUrl: string, account?: string, enableFlexSearch = false): Promise<{ api: API, controller: Controller }> {
  const { augur, blockAndLogStreamerListener, db } = await buildDeps(ethNodeUrl, account, enableFlexSearch);

  const controller = new Controller(augur, db, blockAndLogStreamerListener);
  const api = new API(augur, db);

  return { api, controller };
}

export async function buildAPI(ethNodeUrl: string, account?: string, enableFlexSearch = false): Promise<API> {
  const { augur, db } = await buildDeps(ethNodeUrl, account, enableFlexSearch);

  return new API(augur, db);
}
