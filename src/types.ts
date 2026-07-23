// Data shapes for a single annotation. Kept identical to the HRMS "Live Annotate" model so rows
// migrate 1:1, but with zero backend/framework coupling — this file is pure types.

export type AnnType = 'change' | 'add' | 'remove' | 'bug' | 'style' | 'question'
export type AnnPriority = 'low' | 'med' | 'high'
export type AnnStatus = 'open' | 'in_progress' | 'done' | 'dismissed'
export type AnnKind = 'pin' | 'shape'
export type AnnShape = 'rect' | 'arrow' | 'circle' | 'freehand'
export type AnnVisibility = 'public' | 'private'

export type AnnReply = { note: string; author?: string; at?: string }
export type AnnPoint = { x: number; y: number }
export type AnnMeta = { browser?: string; os?: string; device?: string; viewport?: string; screen?: string; dpr?: number; url?: string; ua?: string }
export type AnnLog = { level: string; text: string; at?: string }

export type Annotation = {
  id: number
  page_route: string
  page_title: string
  target_selector: string
  target_text: string
  pos_x: number
  pos_y: number
  viewport_w: number
  viewport_h: number
  note: string
  type: AnnType
  priority: AnnPriority
  status: AnnStatus
  screenshot_path?: string | null
  screenshot_url?: string | null
  replies?: AnnReply[]
  created_by?: string
  created_at?: string
  updated_at?: string
  // shapes + visibility + author snapshot + captured element styles
  kind?: AnnKind
  shape_type?: AnnShape | null
  x2?: number | null
  y2?: number | null
  points?: AnnPoint[] | null
  color?: string | null
  visibility?: AnnVisibility
  created_by_role?: string | null
  created_by_name?: string | null
  styles?: Record<string, string> | null
  el_context?: string[] | null
  // auto technical context + captured console/JS errors (reproducible bug reports)
  meta?: AnnMeta | null
  console_logs?: AnnLog[] | null
}

// What the overlay hands the adapter to persist a new mark (server assigns id/timestamps/author).
export type NewAnnotation = Omit<Annotation, 'id' | 'status' | 'created_at' | 'updated_at' | 'screenshot_url' | 'created_by' | 'created_by_role' | 'created_by_name'> & {
  screenshot_path?: string | null
}

// A partial edit (status / note / type / priority) applied by id.
export type AnnotationPatch = { id: number } & Partial<Pick<Annotation, 'note' | 'status' | 'type' | 'priority'>>

// The current viewer + their permission envelope, resolved by the adapter.
export type AnnotateAccess = {
  enabled: boolean          // global toggle: is the tool shown to all users, or ADMIN-only?
  isAdmin: boolean          // can flip the global toggle + clear-resolved
  canUse: boolean           // may see/use the tool at all (enabled || isAdmin)
  seeAll: boolean           // sees everyone's marks + can edit them (else own + public only)
  me?: { email?: string; name?: string; role?: string }
}
