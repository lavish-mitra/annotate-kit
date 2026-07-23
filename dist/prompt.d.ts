import { a as Annotation, d as AnnKind, e as AnnShape, f as AnnType, g as AnnPriority, h as AnnStatus, c as AnnVisibility } from './types-BLXmj4Oi.js';

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

export { buildDevContext, buildDevPrompt };
