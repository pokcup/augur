import Dexie from 'dexie';

export interface SyncableInterface {
  databasesToSync(): Array<Dexie.Table<any, any>>;
  getSyncStartingBlock(): Promise<number>;
  rollback(blockNumber: number): Promise<void>;
}
