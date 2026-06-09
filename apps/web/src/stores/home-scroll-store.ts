import { create } from 'zustand'

interface HomeScrollState {
  isTabSticky: boolean
  setTabSticky: (sticky: boolean) => void
}

export const useHomeScrollStore = create<HomeScrollState>((set) => ({
  isTabSticky: false,
  setTabSticky: (sticky) => set({ isTabSticky: sticky }),
}))
