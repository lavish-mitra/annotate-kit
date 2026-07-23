import * as react from 'react';
import { S as StorageAdapter, A as Annotation, a as AnnShape, b as AnnPriority, c as AnnStatus, d as AnnType } from './adapter-DZyFEWur.js';
export { e as AnnKind, f as AnnLog, g as AnnMeta, h as AnnPoint, i as AnnReply, j as AnnVisibility, k as AnnotateAccess, l as AnnotationPatch, N as NewAnnotation } from './adapter-DZyFEWur.js';

type AnnotateProps = {
    /** Your backend binding — see `annotate-kit/supabase` and `annotate-kit/firebase`, or write your own. */
    adapter: StorageAdapter;
    /** Current route path. Pass your router's pathname so marks are page-aware in an SPA.
     *  Omit to read `window.location.pathname` (updates on browser back/forward only). */
    route?: string;
    /** Navigate to a path (used by "find on page" across routes). Default: full-page `window.location.assign`.
     *  Pass your router's navigate for smooth SPA jumps. */
    onNavigate?: (path: string) => void;
    /** Override the current user (else taken from the adapter's access.me). Used for author attribution. */
    user?: {
        email?: string;
        name?: string;
        role?: string;
    };
    /** Hook the widget's toasts into your app's notifications. Omit for a built-in mini-toast. */
    onToast?: (kind: 'success' | 'error', message: string) => void;
    /** How often (ms) to refresh marks while the tool/panel is open. Default 15000. */
    pollMs?: number;
};
declare function Annotate({ adapter, route, onNavigate, user, onToast, pollMs }: AnnotateProps): react.JSX.Element | null;

declare function buildClaudePrompt(items: Annotation[], opts?: {
    title?: string;
}): string;

declare const ANN_MODES: {
    key: 'pin' | AnnShape;
    label: string;
    kbd: string;
}[];
declare const ANN_COLORS: string[];
declare const annShapeLabel: (s?: string | null) => string;
declare const ANN_TYPES: {
    key: AnnType;
    label: string;
    dot: string;
}[];
declare const ANN_PRIORITIES: {
    key: AnnPriority;
    label: string;
}[];
declare const ANN_STATUSES: {
    key: AnnStatus;
    label: string;
}[];
declare const OPEN_STATUSES: AnnStatus[];
declare const annDot: (t?: string) => string;
declare const annTypeLabel: (t?: string) => string;
declare const annStatusLabel: (s?: string) => string;

export { ANN_COLORS, ANN_MODES, ANN_PRIORITIES, ANN_STATUSES, ANN_TYPES, AnnPriority, AnnShape, AnnStatus, AnnType, Annotate, type AnnotateProps, Annotation, OPEN_STATUSES, StorageAdapter, annDot, annShapeLabel, annStatusLabel, annTypeLabel, buildClaudePrompt };
