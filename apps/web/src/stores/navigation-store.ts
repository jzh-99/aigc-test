import { create } from 'zustand'

interface NavigationState {
  /** 是否正在导航中 */
  isLoading: boolean
  /**
   * 标记导航开始（点击链接时调用）
   * @param href 目标路径，若与当前路径相同则跳过，避免同页面点击导致遮罩卡住
   */
  startNavigation: (href?: string) => void
  /** 标记导航结束（pathname 变化时调用） */
  stopNavigation: () => void
}

/**
 * 全局导航加载状态
 *
 * 用于侧边栏/顶部导航点击后立即显示全局加载遮罩，
 * 配合 usePathname 监听在目标页面渲染完成后自动关闭。
 */
export const useNavigationStore = create<NavigationState>((set) => ({
  isLoading: false,
  startNavigation: (href?: string) => {
    // 如果目标路径与当前路径相同，跳过（如同页面内的标签切换）
    if (href) {
      const targetPath = href.split('?')[0]
      if (targetPath === window.location.pathname) return
    }
    set({ isLoading: true })
  },
  stopNavigation: () => set({ isLoading: false }),
}))
