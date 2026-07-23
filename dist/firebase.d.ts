import { Firestore } from 'firebase/firestore';
import { FirebaseStorage } from 'firebase/storage';
import { Auth } from 'firebase/auth';
import { S as StorageAdapter } from './adapter-DZyFEWur.js';

type ResolvedUser = {
    email?: string;
    name?: string;
    role?: string;
};
type FirebaseAdapterConfig = {
    firestore: Firestore;
    storage: FirebaseStorage;
    /** Firebase Auth — used to resolve the current user + admin claim (unless currentUser/isAdmin given). */
    auth?: Auth;
    /** Firestore collection for marks (default 'annotations'). */
    collectionPath?: string;
    /** Firestore doc holding the global toggle (default: 'annotate_settings/global'). */
    settingsPath?: string;
    /** Storage folder for screenshots (default 'annotations'). */
    storagePath?: string;
    /** Is the current viewer an admin? boolean or predicate.
     *  Default: the auth user's custom claim `admin === true` or `role === 'admin'`
     *  (must match backend/firebase/firestore.rules isAdmin()). */
    isAdmin?: boolean | ((user: ResolvedUser) => boolean | Promise<boolean>);
    /** Override current-user resolution (default: auth.currentUser + its ID-token claims). */
    currentUser?: () => Promise<ResolvedUser | null>;
};
declare function createFirebaseAdapter(config: FirebaseAdapterConfig): StorageAdapter;

export { type FirebaseAdapterConfig, type ResolvedUser, createFirebaseAdapter };
