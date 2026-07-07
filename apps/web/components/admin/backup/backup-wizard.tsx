'use client'

import { useState } from 'react'
import { CheckCircle2, Download, Lock, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { WizardShell } from '@/components/admin/backup/wizard-shell'
import { ProgressScreen } from '@/components/admin/backup/progress-screen'
import { CategorySelector } from '@/components/admin/backup/category-selector'
import { BACKUP_CATEGORIES, type BackupCategory } from '@/lib/client/backup-types'
import { type ExportedBackup, downloadBlob, useBackup } from '@/lib/client/hooks/use-backup'

const STEPS = [
  { key: 'select', label: 'Select data' },
  { key: 'generating', label: 'Generating' },
  { key: 'done', label: 'Done' },
]

type Step = 'select' | 'generating' | 'done'

const MIN_PASSWORD = 8

/** Export flow: pick categories → (optionally encrypt) → download the archive. */
export function BackupWizard({ onClose }: { onClose: () => void }) {
  const { exportBackup } = useBackup()
  const [step, setStep] = useState<Step>('select')
  const [selected, setSelected] = useState<Set<BackupCategory>>(
    () => new Set(BACKUP_CATEGORIES.filter(c => c.defaultOn).map(c => c.key)),
  )
  const [encrypt, setEncrypt] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [exported, setExported] = useState<ExportedBackup | null>(null)

  const currentIndex = step === 'select' ? 0 : step === 'generating' ? 1 : 2

  function toggle(key: BackupCategory, on: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const passwordValid = !encrypt || (password.length >= MIN_PASSWORD && password === confirmPassword)
  const canGenerate = selected.size > 0 && passwordValid

  async function handleGenerate() {
    setStep('generating')
    try {
      const result = await exportBackup([...selected], encrypt ? password : undefined)
      setExported(result)
      downloadBlob(result.blob, result.filename)
      setStep('done')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed')
      setStep('select')
    }
  }

  return (
    <WizardShell
      steps={STEPS}
      currentIndex={currentIndex}
      onClose={onClose}
      closeDisabled={step === 'generating'}
    >
      {step === 'select' && (
        <div
          key="select"
          className="space-y-6 animate-in fade-in slide-in-from-right-6 duration-300 motion-reduce:animate-none"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Create a backup</h1>
            <p className="text-sm text-muted-foreground">
              Choose what to include. Everything is exported with its relationships intact.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              This archive contains sensitive secrets (wallet connections, card keys, tokens).
              Store it securely — or encrypt it below.
            </p>
          </div>

          <CategorySelector selected={selected} onToggle={toggle} />

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="encrypt" className="flex items-center gap-2">
                <Lock className="size-4" />
                Encrypt with a password
              </Label>
              <Switch id="encrypt" checked={encrypt} onCheckedChange={setEncrypt} />
            </div>
            {encrypt && (
              <div className="grid gap-3 animate-in fade-in slide-in-from-top-2 duration-200 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pw" className="text-xs">
                    Password
                  </Label>
                  <Input
                    id="pw"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw2" className="text-xs">
                    Confirm
                  </Label>
                  <Input
                    id="pw2"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                  />
                </div>
                {password.length > 0 && password.length < MIN_PASSWORD && (
                  <p className="text-xs text-destructive sm:col-span-2">
                    Password must be at least {MIN_PASSWORD} characters.
                  </p>
                )}
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <p className="text-xs text-destructive sm:col-span-2">Passwords don’t match.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={!canGenerate}>
              <Download className="mr-2 size-4" />
              Create backup
            </Button>
          </div>
        </div>
      )}

      {step === 'generating' && (
        <ProgressScreen
          mode="indeterminate"
          title="Creating your backup"
          statuses={[
            'Reading users…',
            'Collecting cards & designs…',
            'Packing settings…',
            'Compressing archive…',
            encrypt ? 'Encrypting…' : 'Finalizing…',
          ]}
        />
      )}

      {step === 'done' && exported && (
        <div
          key="done"
          className="flex flex-col items-center gap-5 py-10 text-center animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <CheckCircle2 className="size-14 text-emerald-500 animate-in zoom-in-50 duration-500 motion-reduce:animate-none" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Backup ready</h1>
            <p className="text-sm text-muted-foreground">
              Your download should have started. Keep this file somewhere safe.
            </p>
            <p className="text-xs text-muted-foreground">{exported.filename}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => downloadBlob(exported.blob, exported.filename)}>
              <Download className="mr-2 size-4" />
              Download again
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </WizardShell>
  )
}
