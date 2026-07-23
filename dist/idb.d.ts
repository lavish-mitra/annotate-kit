import { S as StorageAdapter } from './adapter-Cyqfwj6F.js';
import './types-BLXmj4Oi.js';

type IdbAdapterConfig = {
    /** Database name (default 'annotate-kit'). */
    dbName?: string;
    /** The single local user shown as author. */
    me?: {
        email?: string;
        name?: string;
        role?: string;
    };
    /** IndexedDB factory (default globalThis.indexedDB). Inject a fake for tests / non-browser envs. */
    factory?: IDBFactory;
};
declare function createIdbAdapter(config?: IdbAdapterConfig): StorageAdapter;

export { type IdbAdapterConfig, createIdbAdapter };
