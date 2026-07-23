// UI catalogs + tiny label helpers for annotations. Pure — no DOM, no backend.
import type { AnnType, AnnPriority, AnnStatus, AnnShape } from './types'

// Drawing modes (pin + shapes) with single-key shortcuts, and the mark colour palette.
export const ANN_MODES: { key: 'pin' | AnnShape; label: string; kbd: string }[] = [
  { key: 'pin', label: 'Pin', kbd: 'P' },
  { key: 'rect', label: 'Box', kbd: 'B' },
  { key: 'arrow', label: 'Arrow', kbd: 'A' },
  { key: 'circle', label: 'Circle', kbd: 'C' },
  { key: 'freehand', label: 'Draw', kbd: 'D' },
]
export const ANN_COLORS = ['#6366f1', '#e11d48', '#0369a1', '#ca8a04', '#15803d', '#7c3aed']
export const annShapeLabel = (s?: string | null): string =>
  s === 'rect' ? 'Box' : s === 'arrow' ? 'Arrow' : s === 'circle' ? 'Circle' : s === 'freehand' ? 'Draw' : 'Shape'

export const ANN_TYPES: { key: AnnType; label: string; dot: string }[] = [
  { key: 'change', label: 'Change', dot: '#6366f1' },
  { key: 'add', label: 'Add', dot: '#10b981' },
  { key: 'remove', label: 'Remove', dot: '#f43f5e' },
  { key: 'bug', label: 'Bug', dot: '#ef4444' },
  { key: 'style', label: 'Style', dot: '#f59e0b' },
  { key: 'question', label: 'Question', dot: '#64748b' },
]
export const ANN_PRIORITIES: { key: AnnPriority; label: string }[] = [
  { key: 'high', label: 'High' }, { key: 'med', label: 'Medium' }, { key: 'low', label: 'Low' },
]
export const ANN_STATUSES: { key: AnnStatus; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'in_progress', label: 'In progress' }, { key: 'done', label: 'Done' }, { key: 'dismissed', label: 'Dismissed' },
]
export const OPEN_STATUSES: AnnStatus[] = ['open', 'in_progress']

export const annDot = (t?: string): string => ANN_TYPES.find((x) => x.key === t)?.dot ?? '#6366f1'
export const annTypeLabel = (t?: string): string => ANN_TYPES.find((x) => x.key === t)?.label ?? 'Change'
export const annStatusLabel = (s?: string): string => ANN_STATUSES.find((x) => x.key === s)?.label ?? 'Open'
export const PRIORITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 }
