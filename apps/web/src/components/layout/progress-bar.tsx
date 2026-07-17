'use client'

import { AppProgressBar } from 'next-nprogress-bar'

export function ProgressBar() {
  return (
    <AppProgressBar
      height="2px"
      color="#818cf8"
      options={{ showSpinner: false }}
      shallowRouting
    />
  )
}
