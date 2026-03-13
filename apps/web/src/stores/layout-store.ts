import { create } from 'zustand'

interface LayoutState {
  sidebarCollapsed: boolean
  mobileOpen: boolean
  toggleSidebar: () => void
  setMobileOpen: (open: boolean) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarCollapsed: false,
  mobileOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
}))
