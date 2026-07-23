// The one seam between the overlay and your backend. Implement these 8 methods for any store
// (Supabase / Firebase / your own API) and the entire Annotate UI works unchanged. Ready-made
// adapters ship at `annotate-kit/supabase` and `annotate-kit/firebase`.
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess } from './types'

export interface StorageAdapter {
  /** Who is looking + what they may do. Called on mount (and after toggling access). */
  getAccess(): Promise<AnnotateAccess>
  /** Flip the global "visible to all users" toggle (ADMIN only). */
  setAccess(enabled: boolean): Promise<{ message?: string }>
  /** All marks the viewer may see, each with `screenshot_url` resolved for display. */
  list(): Promise<Annotation[]>
  /** Persist a new mark; returns its new id. */
  save(input: NewAnnotation): Promise<{ id: number }>
  /** Patch a mark (status/note/type/priority) by id. */
  update(patch: AnnotationPatch): Promise<void>
  /** Delete a mark (and its screenshot) by id. */
  remove(id: number): Promise<void>
  /** Append a follow-up reply to a mark. */
  addReply(id: number, note: string): Promise<void>
  /** Delete every done/dismissed mark (ADMIN/see-all cleanup). */
  clearResolved(): Promise<{ message?: string }>
  /** Upload a screenshot; returns the storage path stored on the row (list() turns it into a URL). */
  uploadScreenshot(file: File): Promise<{ path: string }>
}
