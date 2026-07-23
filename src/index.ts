// annotate-kit — public entry.
// Component + pure logic + the adapter contract. Backend adapters are separate entry points:
//   import { createSupabaseAdapter } from 'annotate-kit/supabase'
//   import { createFirebaseAdapter } from 'annotate-kit/firebase'
// and the styles are a single import:  import 'annotate-kit/styles.css'
export { Annotate } from './Annotate'
export type { AnnotateProps } from './Annotate'
export { buildDevPrompt, buildDevContext } from './prompt'
export { githubIssueDelivery, createWebhookDelivery, createSlackDelivery } from './delivery'
export type { Delivery } from './delivery'
export {
  ANN_MODES, ANN_COLORS, ANN_TYPES, ANN_PRIORITIES, ANN_STATUSES, OPEN_STATUSES,
  annDot, annTypeLabel, annStatusLabel, annShapeLabel,
} from './constants'
export type { StorageAdapter } from './adapter'
export type {
  Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess,
  AnnType, AnnPriority, AnnStatus, AnnKind, AnnShape, AnnVisibility,
  AnnReply, AnnPoint, AnnMeta, AnnLog, AnnNetLog,
} from './types'
