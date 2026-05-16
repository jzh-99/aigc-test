'use client'

import { AuthThemeContext } from '@/context/auth-theme-context'
import type { AuthTheme } from '@/config/auth-themes'

export function AuthThemeProvider({
  theme,
  children,
}: {
  theme: AuthTheme
  children: React.ReactNode
}) {
  return (
    <AuthThemeContext.Provider value={theme}>
      {children}
    </AuthThemeContext.Provider>
  )
}
