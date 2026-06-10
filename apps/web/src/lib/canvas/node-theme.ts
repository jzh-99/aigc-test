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
    headerClassName: 'bg-gradient-to-r from-slate-900/75 to-indigo-950/35',
    iconClassName: 'text-indigo-300',
    menuButtonClassName: 'bg-gradient-to-r from-slate-900/75 to-indigo-950/40 hover:from-slate-900/75 hover:to-indigo-950/40 text-indigo-100 border border-indigo-800/70 shadow-sm',
  },
  image_gen: {
    miniMapColor: '#2563eb',
    miniMapStrokeColor: '#1e40af',
    headerClassName: 'bg-gradient-to-r from-sky-950/45 to-cyan-950/30',
    iconClassName: 'text-sky-300',
    menuButtonClassName: 'bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 text-white shadow-sm shadow-blue-500/20',
  },
  video_gen: {
    miniMapColor: '#7c3aed',
    miniMapStrokeColor: '#5b21b6',
    headerClassName: 'bg-gradient-to-r from-violet-950/45 to-fuchsia-950/30',
    iconClassName: 'text-violet-300',
    menuButtonClassName: 'bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white shadow-sm shadow-violet-500/20',
  },
  audio_gen: {
    miniMapColor: '#10b981',
    miniMapStrokeColor: '#047857',
    headerClassName: 'bg-gradient-to-r from-emerald-950/45 to-lime-950/30',
    iconClassName: 'text-emerald-300',
    menuButtonClassName: 'bg-gradient-to-r from-emerald-600 to-lime-500 hover:from-emerald-500 hover:to-lime-400 text-white shadow-sm shadow-emerald-500/20',
  },
  asset: {
    miniMapColor: '#059669',
    miniMapStrokeColor: '#047857',
    headerClassName: 'bg-gradient-to-r from-emerald-950/45 to-teal-950/30',
    iconClassName: 'text-emerald-300',
    menuButtonClassName: 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-sm shadow-emerald-500/20',
  },
  script_writer: {
    miniMapColor: '#d97706',
    miniMapStrokeColor: '#92400e',
    headerClassName: 'bg-gradient-to-r from-amber-950/45 to-orange-950/30',
    iconClassName: 'text-amber-300',
    menuButtonClassName: 'bg-gradient-to-r from-amber-500 to-orange-400 hover:from-amber-400 hover:to-orange-300 text-amber-950 shadow-sm shadow-amber-500/20',
  },
  storyboard_splitter: {
    miniMapColor: '#a855f7',
    miniMapStrokeColor: '#7e22ce',
    headerClassName: 'bg-gradient-to-r from-rose-950/35 to-violet-950/40',
    iconClassName: 'text-fuchsia-300',
    menuButtonClassName: 'bg-gradient-to-r from-rose-950/40 to-violet-950/50 hover:from-rose-950/60 hover:to-violet-950/70 text-violet-100 border border-violet-800 shadow-sm',
  },
  video_stitch: {
    miniMapColor: '#e11d48',
    miniMapStrokeColor: '#9f1239',
    headerClassName: 'bg-gradient-to-r from-rose-950/45 to-red-950/30',
    iconClassName: 'text-rose-300',
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
