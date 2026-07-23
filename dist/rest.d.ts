import { S as StorageAdapter } from './adapter-Cyqfwj6F.js';
import './types-BLXmj4Oi.js';

type RestEndpoints = {
    access: string;
    list: string;
    create: string;
    item: (id: number) => string;
    replies: (id: number) => string;
    clearResolved: string;
    screenshots: string;
};
type RestAdapterConfig = {
    /** Base URL of your annotations API, e.g. '/api/annotations' or 'https://api.example.com/annotations'. */
    baseUrl: string;
    /** Extra headers (e.g. Authorization). A function is re-evaluated per request, so tokens stay fresh. */
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
    /** Cookie policy for requests (default 'same-origin'). Use 'include' for cross-origin cookies. */
    credentials?: RequestCredentials;
    /** Custom fetch implementation (default: global fetch). */
    fetch?: typeof fetch;
    /** Override any endpoint (absolute URL or relative to baseUrl). */
    endpoints?: Partial<RestEndpoints>;
};
declare function createRestAdapter(config: RestAdapterConfig): StorageAdapter;

export { type RestAdapterConfig, type RestEndpoints, createRestAdapter };
