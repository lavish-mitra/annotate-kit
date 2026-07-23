import { S as StorageAdapter } from './adapter-Cyqfwj6F.js';
import './types-BLXmj4Oi.js';

type LocalAdapterConfig = {
    /** localStorage key holding all data (default 'annotate-kit'). */
    storageKey?: string;
    /** The single local user shown as author. */
    me?: {
        email?: string;
        name?: string;
        role?: string;
    };
    /** Storage backend (default globalThis.localStorage). Pass a mock for tests / non-browser envs. */
    storage?: Storage;
};
declare function createLocalAdapter(config?: LocalAdapterConfig): StorageAdapter;

export { type LocalAdapterConfig, createLocalAdapter };
