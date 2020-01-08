import { createSeed } from '@augurproject/tools/build';
import { writeSeedFile } from '@augurproject/tools/build/libs/ganache';
import { writeFileSync } from 'fs';
import * as path from 'path';

import { makeProvider, makeProviderWithDB } from '../../libs';
import {
  ContractAPI,
  loadSeedFile,
  ACCOUNTS,
  defaultSeedPath,
} from '@augurproject/tools';

(async () => {
  const seed = await loadSeedFile(defaultSeedPath);
  const [db, provider] = await makeProviderWithDB(seed, ACCOUNTS);

  const john = await ContractAPI.userWrapper(
    ACCOUNTS[0],
    provider,
    seed.addresses
  );
  await john.approveCentralAuthority();

  await john.createReasonableYesNoMarket();
  await john.createReasonableYesNoMarket();

  const newSeed = await createSeed(provider, db, seed.addresses);
  await writeSeedFile(newSeed, '/tmp/newSeed.json');
})().catch(e => console.error(e));
