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
    /** Upload a screenshot; returns the storage path stored on the row (list() turns it into a URL). */
    uploadScreenshot(file: File): Promise<{
        path: string;
    }>;
}

export type { Annotation as A, NewAnnotation as N, StorageAdapter as S, AnnShape as a, AnnPriority as b, AnnStatus as c, AnnType as d, AnnKind as e, AnnLog as f, AnnMeta as g, AnnPoint as h, AnnReply as i, AnnVisibility as j, AnnotateAccess as k, AnnotationPatch as l };
