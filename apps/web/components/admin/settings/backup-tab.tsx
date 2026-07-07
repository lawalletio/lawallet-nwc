'use client'

import { type ReactNode, useState } from 'react'
import { Download, HardDriveDownload, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BackupWizard } from '@/components/admin/backup/backup-wizard'
import { RestoreWizard } from '@/components/admin/backup/restore-wizard'

type ActiveWizard = null | 'export' | 'restore'

/** Settings ▸ Backup & Restore tab: entry points for both wizards. */
export function BackupTab() {
  const [wizard, setWizard] = useState<ActiveWizard>(null)

  return (
    <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-8 px-4 pb-8 pt-10">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <HardDriveDownload className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Backup &amp; Restore</h2>
          <p className="text-sm text-muted-foreground">
            Export a complete, relationship-aware snapshot of this instance, or restore one into it.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ActionCard
          icon={<Download className="size-6" />}
          title="Create backup"
          description="Download users, addresses, wallets, cards, settings and more as a single archive — optionally password-encrypted."
          actionLabel="Create backup"
          onClick={() => setWizard('export')}
        />
        <ActionCard
          icon={<Upload className="size-6" />}
          title="Restore backup"
          description="Upload an archive, review conflicts, and restore it — merging into your data or replacing it entirely."
          actionLabel="Restore backup"
          onClick={() => setWizard('restore')}
        />
      </div>

      {wizard === 'export' && <BackupWizard onClose={() => setWizard(null)} />}
      {wizard === 'restore' && <RestoreWizard onClose={() => setWizard(null)} />}
    </div>
  )
}

function ActionCard({
  icon,
  title,
  description,
  actionLabel,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  actionLabel: string
  onClick: () => void
}) {
  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="flex h-full flex-col gap-4 p-6">
        <div className="text-primary">{icon}</div>
        <div className="flex-1 space-y-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button className="w-full" onClick={onClick}>
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
