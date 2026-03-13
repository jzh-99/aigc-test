'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown, Building2, FolderOpen } from 'lucide-react'
import { useState } from 'react'

interface WorkspaceSwitcherProps {
  collapsed?: boolean
}

export function WorkspaceSwitcher({ collapsed }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const { user, activeTeamId, activeWorkspaceId, setActiveTeam, setActiveWorkspace } = useAuthStore()

  const activeTeam = useAuthStore((s) => s.activeTeam())
  const activeWorkspace = useAuthStore((s) => s.activeWorkspace())

  if (!user || user.teams.length === 0) return null

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-2">
        <div className="h-8 w-8 rounded-lg bg-accent-blue/10 flex items-center justify-center">
          <Building2 className="h-4 w-4 text-accent-blue" />
        </div>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-3 h-auto py-2 text-left"
        >
          <div className="flex flex-col items-start truncate">
            <span className="text-xs text-muted-foreground truncate w-full">
              {activeTeam?.name ?? '选择团队'}
            </span>
            <span className="text-sm font-medium truncate w-full">
              {activeWorkspace?.name ?? '选择工作区'}
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        {user.teams.map((team) => (
          <div key={team.id} className="mb-2 last:mb-0">
            <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3 w-3" />
              {team.name}
            </div>
            {team.workspaces.map((ws) => (
              <button
                key={ws.id}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors',
                  activeWorkspaceId === ws.id && 'bg-muted font-medium'
                )}
                onClick={() => {
                  if (activeTeamId !== team.id) setActiveTeam(team.id)
                  setActiveWorkspace(ws.id)
                  setOpen(false)
                }}
              >
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{ws.name}</span>
                {activeWorkspaceId === ws.id && (
                  <Check className="ml-auto h-3.5 w-3.5 text-accent-blue" />
                )}
              </button>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
