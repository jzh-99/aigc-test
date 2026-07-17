import { createContext, useContext } from 'react'
import type { AuthTheme } from '@/config/auth-themes'
import { AUTH_THEMES, ACTIVE_AUTH_THEME } from '@/config/auth-themes'

export const AuthThemeContext = createContext<AuthTheme>(AUTH_THEMES[ACTIVE_AUTH_THEME])

export function useAuthTheme(): AuthTheme {
  return useContext(AuthThemeContext)
}
