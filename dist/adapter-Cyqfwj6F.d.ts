import { A as AnnotateAccess, a as Annotation, N as NewAnnotation, b as AnnotationPatch, c as AnnVisibility } from './types-BLXmj4Oi.js';

interface StorageAdapter {
    /** Who is looking + what they may do. Called on mount (and after toggling access). */
    getAccess(): Promise<AnnotateAccess>;
    /** Flip the global "visible to all users" toggle (ADMIN only). */
    setAccess(enabled: boolean): Promise<{
        message?: string;
    }>;
    /** All marks the viewer may see, each with `screenshot_url` resolved for display. */
    list(): Promise<Annotation[]>;
    /** Persist a new mark; returns its new id. */
    save(input: NewAnnotation): Promise<{
        id: number;
    }>;
    /** Patch a mark (status/note/type/priority) by id. */
    update(patch: AnnotationPatch): Promise<void>;
    /** Delete a mark (and its screenshot) by id. */
    remove(id: number): Promise<void>;
    /** Append a follow-up reply to a mark. */
    addReply(id: number, note: string): Promise<void>;
    /** Delete every done/dismissed mark (ADMIN/see-all cleanup). */
    clearResolved(): Promise<{
        message?: string;
    }>;
    /** Upload a screenshot; returns the storage path stored on the row (list() turns it into a URL).
     *  `visibility` decides where the file lives: a 'public' mark's screenshot is readable by any
     *  authenticated user, a 'private' one only by its owner/admin. Defaults to 'private'. */
    uploadScreenshot(file: File, opts?: {
        visibility?: AnnVisibility;
    }): Promise<{
        path: string;
    }>;
    /** Optional: subscribe to live changes and call `onChange` when marks may have changed.
     *  Return an unsubscribe function. When present, the overlay updates in real time (with a slow
     *  poll as a safety net) instead of polling only while open. */
    subscribe?(onChange: () => void): () => void;
}

export type { StorageAdapter as S };
