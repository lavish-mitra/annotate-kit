import * as react from 'react';

type AnnType = 'change' | 'add' | 'remove' | 'bug' | 'style' | 'question';
type AnnPriority = 'low' | 'med' | 'high';
type AnnStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
type AnnKind = 'pin' | 'shape';
type AnnShape = 'rect' | 'arrow' | 'circle' | 'freehand';
type AnnVisibility = 'public' | 'private';
type AnnReply = {
    note: string;
    author?: string;
    at?: string;
};
type AnnPoint = {
    x: number;
    y: number;
};
type AnnMeta = {
    browser?: string;
    os?: string;
    device?: string;
    viewport?: string;
    screen?: string;
    dpr?: number;
    url?: string;
    ua?: string;
};
type AnnLog = {
    level: string;
    text: string;
    at?: string;
};
type AnnNetLog = {
    method: string;
    url: string;
    status?: number;
    ms?: number;
    ok?: boolean;
    at?: string;
};
type Annotation = {
    id: number;
    page_route: string;
    page_title: string;
    target_selector: string;
    target_text: string;
    pos_x: number;
    pos_y: number;
    viewport_w: number;
    viewport_h: number;
    note: string;
    type: AnnType;
    priority: AnnPriority;
    status: AnnStatus;
    screenshot_path?: string | null;
    screenshot_url?: string | null;
    replies?: AnnReply[];
    created_by?: string;
    created_at?: string;
    updated_at?: string;
    kind?: AnnKind;
    shape_type?: AnnShape | null;
    x2?: number | null;
    y2?: number | null;
    points?: AnnPoint[] | null;
    color?: string | null;
    visibility?: AnnVisibility;
    created_by_role?: string | null;
    created_by_name?: string | null;
    styles?: Record<string, string> | null;
    el_context?: string[] | null;
    meta?: AnnMeta | null;
    console_logs?: AnnLog[] | null;
    network_logs?: AnnNetLog[] | null;
    dom_snapshot?: string | null;
};
type NewAnnotation = Omit<Annotation, 'id' | 'status' | 'created_at' | 'updated_at' | 'screenshot_url' | 'created_by' | 'created_by_role' | 'created_by_name'> & {
    screenshot_path?: string | null;
};
type AnnotationPatch = {
    id: number;
} & Partial<Pick<Annotation, 'note' | 'status' | 'type' | 'priority'>>;
type AnnotateAccess = {
    enabled: boolean;
    isAdmin: boolean;
    canUse: boolean;
    seeAll: boolean;
    me?: {
        email?: string;
        name?: string;
        role?: string;
    };
};

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

type Delivery = {
    /** Button label shown in the Send panel. */
    label: string;
    /** URL target — opens a prefilled page in a new tab (no token needed). */
    href?: (items: Annotation[]) => string;
    /** POST target — invoked on click (webhook / Slack / your API). */
    run?: (items: Annotation[]) => Promise<void> | void;
};
/** Zero-config: open a prefilled "New issue" page for a GitHub repo. No token required. */
declare function githubIssueDelivery(opts: {
    repo: string;
    label?: string;
    titlePrefix?: string;
}): Delivery;
/** POST the markdown prompt + structured context to any HTTP endpoint you control. */
declare function createWebhookDelivery(opts: {
    url: string;
    label?: string;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
}): Delivery;
/** POST the prompt to a Slack Incoming Webhook URL (the integrator creates it). */
declare function createSlackDelivery(opts: {
    webhookUrl: string;
    label?: string;
    fetch?: typeof fetch;
}): Delivery;

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
    /** Capture a rolling console/JS-error buffer with each mark (secrets may appear in logs).
     *  Default false — opt in only if your team needs console context for bug reports. */
    captureConsole?: boolean;
    /** Store the full URL (incl. query string + hash) instead of just origin + pathname.
     *  Default false — query strings often carry tokens/PII. */
    captureFullUrl?: boolean;
    /** Capture on-screen element text (target text + surrounding labels) with each mark.
     *  Default true; set false for apps that display sensitive data. */
    captureText?: boolean;
    /** Enable bare single-key tool shortcuts (P/B/A/C/D). Default true. Set false to avoid
     *  collisions with the host app's own single-key shortcuts. */
    singleKeyShortcuts?: boolean;
    /** Capture a rolling buffer of failed/slow network requests (fetch + XHR) with each mark.
     *  Default false — URLs are trimmed + redacted, but opt in deliberately. */
    captureNetwork?: boolean;
    /** Capture a sanitised HTML snapshot of the marked element (scripts/handlers stripped, password
     *  values blanked, truncated). Default false — the DOM can contain sensitive content. */
    captureDomSnapshot?: boolean;
    /** Blur password fields and any `[data-annot-redact]` element in screenshots. Default true. */
    redactScreenshots?: boolean;
    /** Colour theme for the widget's own panels/dock: 'light' (default), 'dark', or 'auto'
     *  (follows the OS via prefers-color-scheme). Does not affect the host page. */
    theme?: 'light' | 'dark' | 'auto';
    /** Override the brand accent colour (any valid CSS colour, e.g. '#0ea5e9'). Themes buttons, active
     *  tools, links, and highlights. Invalid values are ignored. */
    accent?: string;
    /** Redact secrets/PII from captured text + console before it is stored. Return the cleaned
     *  string. Default masks JWTs, bearer tokens, emails, and long digit runs (cards/SSNs). */
    redact?: (text: string) => string;
    /** Optional "send to…" targets shown in the Send panel (GitHub issue / webhook / Slack / your own).
     *  Off by default — see the `githubIssueDelivery` / `createWebhookDelivery` / `createSlackDelivery` helpers. */
    deliveries?: Delivery[];
};
declare function Annotate({ adapter, route, onNavigate, user, onToast, pollMs, captureConsole, captureFullUrl, captureText, singleKeyShortcuts, captureNetwork, captureDomSnapshot, redactScreenshots, theme, accent, redact, deliveries }: AnnotateProps): react.ReactPortal | null;

declare function buildDevPrompt(items: Annotation[], opts?: {
    title?: string;
    includeConsole?: boolean;
    includeNetwork?: boolean;
}): string;
declare function buildDevContext(items: Annotation[]): {
    total: number;
    items: {
        id: number;
        page_route: string;
        page_title: string;
        kind: AnnKind;
        shape_type: AnnShape | null;
        type: AnnType;
        priority: AnnPriority;
        status: AnnStatus;
        visibility: AnnVisibility;
        element: {
            selector: string | null;
            text: string | null;
        };
        where: string[];
        note: string;
        author: string | null;
        env: {
            browser: string | null;
            os: string | null;
            device: string | null;
            viewport: string | null;
            url: string | null;
        } | null;
        replies: {
            note: string;
            author: string | null;
            at: string | null;
        }[];
        console: {
            level: string;
            text: string;
        }[];
        network: {
            method: string;
            url: string;
            status: number | null;
            ms: number | null;
        }[];
        domSnapshot: string | null;
        hasScreenshot: boolean;
    }[];
};

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

export { ANN_COLORS, ANN_MODES, ANN_PRIORITIES, ANN_STATUSES, ANN_TYPES, type AnnKind, type AnnLog, type AnnMeta, type AnnNetLog, type AnnPoint, type AnnPriority, type AnnReply, type AnnShape, type AnnStatus, type AnnType, type AnnVisibility, Annotate, type AnnotateAccess, type AnnotateProps, type Annotation, type AnnotationPatch, type Delivery, type NewAnnotation, OPEN_STATUSES, type StorageAdapter, annDot, annShapeLabel, annStatusLabel, annTypeLabel, buildDevContext, buildDevPrompt, createSlackDelivery, createWebhookDelivery, githubIssueDelivery };
