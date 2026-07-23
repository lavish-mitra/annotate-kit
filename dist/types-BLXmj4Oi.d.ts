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

export type { AnnotateAccess as A, NewAnnotation as N, Annotation as a, AnnotationPatch as b, AnnVisibility as c, AnnKind as d, AnnShape as e, AnnType as f, AnnPriority as g, AnnStatus as h };
