import type { CanvasNodeType } from './types'

type CanvasNodeTheme = {
  miniMapColor: string
  miniMapStrokeColor: string
  headerClassName: string
  iconClassName: string
  menuButtonClassName: string
}

const DEFAULT_NODE_THEME: CanvasNodeTheme = {
  miniMapColor: '#c4c4cc',
  miniMapStrokeColor: '#a1a1aa',
  headerClassName: 'bg-gradient-to-r from-muted to-background',
  iconClassName: 'text-muted-foreground',
  menuButtonClassName: 'bg-muted hover:bg-accent text-foreground border border-border',
}

export const CANVAS_NODE_THEMES = {
  text_input: {
    miniMapColor: '#78716c',
    miniMapStrokeColor: '#57534e',
    headerClassName: 'bg-gradient-to-r from-slate-50 to-indigo-50 dark:from-slate-900/75 dark:to-indigo-950/35',
    iconClassName: 'text-indigo-500 dark:text-indigo-300',
    menuButtonClassName: 'bg-gradient-to-r from-slate-50 to-indigo-50 hover:from-slate-100 hover:to-indigo-100 text-slate-800 border border-indigo-100 shadow-sm dark:from-slate-900/75 dark:to-indigo-950/40 dark:text-indigo-100 dark:border-indigo-800/70',
  },
  image_gen: {
    miniMapColor: '#2563eb',
    miniMapStrokeColor: '#1e40af',
    headerClassName: 'bg-gradient-to-r from-sky-50 to-cyan-50 dark:from-sky-950/45 dark:to-cyan-950/30',
    iconClassName: 'text-sky-500 dark:text-sky-300',
    menuButtonClassName: 'bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 text-white shadow-sm shadow-blue-500/20',
  },
  video_gen: {
    miniMapColor: '#7c3aed',
    miniMapStrokeColor: '#5b21b6',
    headerClassName: 'bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-950/45 dark:to-fuchsia-950/30',
    iconClassName: 'text-violet-500 dark:text-violet-300',
    menuButtonClassName: 'bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white shadow-sm shadow-violet-500/20',
  },
  asset: {
    miniMapColor: '#059669',
    miniMapStrokeColor: '#047857',
    headerClassName: 'bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/45 dark:to-teal-950/30',
    iconClassName: 'text-emerald-500 dark:text-emerald-300',
    menuButtonClassName: 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-sm shadow-emerald-500/20',
  },
  script_writer: {
    miniMapColor: '#d97706',
    miniMapStrokeColor: '#92400e',
    headerClassName: 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/45 dark:to-orange-950/30',
    iconClassName: 'text-amber-500 dark:text-amber-300',
    menuButtonClassName: 'bg-gradient-to-r from-amber-500 to-orange-400 hover:from-amber-400 hover:to-orange-300 text-amber-950 shadow-sm shadow-amber-500/20',
  },
  storyboard_splitter: {
    miniMapColor: '#a855f7',
    miniMapStrokeColor: '#7e22ce',
    headerClassName: 'bg-gradient-to-r from-rose-50 to-violet-50 dark:from-rose-950/35 dark:to-violet-950/40',
    iconClassName: 'text-fuchsia-500 dark:text-fuchsia-300',
    menuButtonClassName: 'bg-gradient-to-r from-rose-100 to-violet-100 hover:from-rose-200 hover:to-violet-200 text-violet-800 border border-violet-200 shadow-sm dark:from-rose-950/40 dark:to-violet-950/50 dark:hover:from-rose-950/60 dark:hover:to-violet-950/70 dark:text-violet-100 dark:border-violet-800',
  },
  video_stitch: {
    miniMapColor: '#e11d48',
    miniMapStrokeColor: '#9f1239',
    headerClassName: 'bg-gradient-to-r from-rose-50 to-red-50 dark:from-rose-950/45 dark:to-red-950/30',
    iconClassName: 'text-rose-500 dark:text-rose-300',
    menuButtonClassName: 'bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white shadow-sm shadow-rose-500/20',
  },
} satisfies Record<CanvasNodeType, CanvasNodeTheme>

export function getCanvasNodeTheme(type: string | undefined): CanvasNodeTheme {
  if (!type || !(type in CANVAS_NODE_THEMES)) return DEFAULT_NODE_THEME
  return CANVAS_NODE_THEMES[type as CanvasNodeType]
}

export function getCanvasNodeMiniMapColor(type: string | undefined): string {
  return getCanvasNodeTheme(type).miniMapColor
}

export function getCanvasNodeMiniMapStrokeColor(type: string | undefined): string {
  return getCanvasNodeTheme(type).miniMapStrokeColor
}
