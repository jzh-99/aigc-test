'use client'

import Link from 'next/link'
import { useTeamFeatures } from '@/hooks/use-team-features'
import type { CreativeEntryAction } from './creative-home-data'

interface CreativeEntryActionsProps {
  actions: CreativeEntryAction[]
}

export function CreativeEntryActions({ actions }: CreativeEntryActionsProps) {
  const { showVideoStudioTab } = useTeamFeatures()
  const visibleActions = actions.filter((action) => {
    if (action.href === '/video-studio') return showVideoStudioTab
    return true
  })

  return (
    <>
      {visibleActions.map((action, actionIndex) => (
        <Link
          key={action.href}
          href={action.href}
          className={
            actionIndex === 0
              ? 'inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
              : 'inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary'
          }
        >
          {action.label}
        </Link>
      ))}
    </>
  )
}
