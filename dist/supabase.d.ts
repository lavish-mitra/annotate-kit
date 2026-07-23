import { SupabaseClient } from '@supabase/supabase-js';
import { S as StorageAdapter } from './adapter-DZyFEWur.js';

type SupabaseAdapterConfig = {
    client: SupabaseClient;
    /** Table name (default 'annotations'). */
    table?: string;
    /** Private storage bucket for screenshots (default 'annotations'). */
    bucket?: string;
    /** Single-row global toggle table (default 'annotate_settings'). */
    settingsTable?: string;
    /** Signed-URL lifetime for screenshots, seconds (default 3600). */
    signedUrlTtl?: number;
    /** Is the current viewer an admin? A boolean, or a predicate over the resolved user.
     *  Default: true when the auth user's `app_metadata.role === 'admin'` or `app_metadata.annotate_admin === true`
     *  (must match backend/supabase/migration.sql's annotate_is_admin()). */
    isAdmin?: boolean | ((user: ResolvedUser) => boolean | Promise<boolean>);
    /** Override how the current user is resolved (default: supabase.auth.getUser()). */
    currentUser?: () => Promise<ResolvedUser | null>;
};
type ResolvedUser = {
    email?: string;
    name?: string;
    role?: string;
};
declare function createSupabaseAdapter(config: SupabaseAdapterConfig): StorageAdapter;

export { type ResolvedUser, type SupabaseAdapterConfig, createSupabaseAdapter };
