export type AuthThemeId = 'cloud-dawn' | 'abyss-refraction'

export interface AuthTheme {
  id: AuthThemeId
  /** public/ 下的背景图路径 */
  backgroundImage?: string
  /** 应用到最外层容器的 CSS class */
  layoutClass: string
  /** 注入到 Card 组件的额外 CSS class */
  cardClass: string
  /** 背景遮罩 class，覆盖在背景图上 */
  overlayClass?: string
  /** 是否显示浮动光斑装饰 */
  showOrbs?: boolean
}

export const AUTH_THEMES: Record<AuthThemeId, AuthTheme> = {
  'cloud-dawn': {
    id: 'cloud-dawn',
    layoutClass: 'bg-muted',
    cardClass: '',
    showOrbs: false,
  },
  'abyss-refraction': {
    id: 'abyss-refraction',
    backgroundImage: '/themes/1.jpg',
    layoutClass: 'auth-bg-abyss',
    cardClass: 'auth-card-glass',
    overlayClass: 'auth-overlay-abyss',
    showOrbs: true,
  },
}

/** 修改此处切换当前激活主题 */
export const ACTIVE_AUTH_THEME: AuthThemeId = 'abyss-refraction'
