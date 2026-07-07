'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, GitMerge, Lock, Replace } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { WizardShell } from '@/components/admin/backup/wizard-shell'
import { ProgressScreen } from '@/components/admin/backup/progress-screen'
import { FileDropzone } from '@/components/admin/backup/file-dropzone'
import { TableSummaryGrid } from '@/components/admin/backup/table-summary-grid'
import { ConflictList, type DefaultStrategy } from '@/components/admin/backup/conflict-list'
import { ResultSummary } from '@/components/admin/backup/result-summary'
import {
  BACKUP_PASSWORD_INVALID,
  BACKUP_PASSWORD_REQUIRED,
  type BackupAnalyzeResponse,
  type BackupConflict,
  type BackupImportMode,
  type BackupImportResult,
  type BackupResolutionStrategy,
} from '@/lib/client/backup-types'
import { BackupRequestError, useBackup } from '@/lib/client/hooks/use-backup'
import { clearApiCache } from '@/lib/client/hooks/use-api'

const STEPS = [
  { key: 'file', label: 'File' },
  { key: 'mode', label: 'Mode' },
  { key: 'review', label: 'Review' },
  { key: 'import', label: 'Restore' },
  { key: 'done', label: 'Done' },
]

type Step = 'select-file' | 'choose-mode' | 'analyzing' | 'review' | 'importing' | 'result'

function stepIndex(step: Step): number {
  switch (step) {
    case 'select-file':
      return 0
    case 'choose-mode':
      return 1
    case 'analyzing':
    case 'review':
      return 2
    case 'importing':
      return 3
    case 'result':
      return 4
  }
}

/** Restore flow: file → mode → analyze → review/confirm → import → result. */
export function RestoreWizard({ onClose }: { onClose: () => void }) {
  const { analyzeBackup, importBackup } = useBackup()
  const [step, setStep] = useState<Step>('select-file')
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [mode, setMode] = useState<BackupImportMode>('merge')
  const [analysis, setAnalysis] = useState<BackupAnalyzeResponse | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, BackupResolutionStrategy>>({})
  const [defaultStrategy, setDefaultStrategy] = useState<DefaultStrategy>('skip')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [result, setResult] = useState<BackupImportResult | null>(null)

  const busy = step === 'analyzing' || step === 'importing'

  const allConflicts = useMemo<BackupConflict[]>(() => {
    if (!analysis) return []
    return Object.values(analysis.tables).flatMap(t => t?.conflicts ?? [])
  }, [analysis])

  // Invalid rows can't be resolved — surface them in the grid, not the list.
  const resolvableConflicts = useMemo(
    () => allConflicts.filter(c => c.kind !== 'invalid-row'),
    [allConflicts],
  )

  const tally = useMemo(() => {
    if (!analysis) return { willImport: 0, willSkip: 0, unchanged: 0 }
    let newRows = 0
    let unchanged = 0
    for (const t of Object.values(analysis.tables)) {
      if (!t) continue
      newRows += t.counts.new
      unchanged += t.counts.identical
    }
    let importFromConflicts = 0
    let skip = 0
    for (const conflict of resolvableConflicts) {
      const strategy = resolutions[conflict.id] ?? conflict.suggestedStrategy
      if (strategy === 'skip') skip++
      else importFromConflicts++
    }
    return { willImport: newRows + importFromConflicts, willSkip: skip, unchanged }
  }, [analysis, resolvableConflicts, resolutions])

  async function runAnalyze() {
    if (!file) return
    setStep('analyzing')
    try {
      const plan = await analyzeBackup(file, needsPassword ? password : undefined)
      setAnalysis(plan)
      const seeded: Record<string, BackupResolutionStrategy> = {}
      for (const conflict of Object.values(plan.tables).flatMap(t => t?.conflicts ?? [])) {
        if (conflict.kind !== 'invalid-row') seeded[conflict.id] = conflict.suggestedStrategy
      }
      setResolutions(seeded)
      setStep('review')
    } catch (error) {
      if (
        error instanceof BackupRequestError &&
        (error.code === BACKUP_PASSWORD_REQUIRED || error.code === BACKUP_PASSWORD_INVALID)
      ) {
        setNeedsPassword(true)
        setPasswordError(
          error.code === BACKUP_PASSWORD_INVALID
            ? 'Incorrect password. Try again.'
            : 'This backup is password-protected.',
        )
        setStep('select-file')
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not read this backup')
        setStep('select-file')
      }
    }
  }

  async function runImport() {
    if (!file) return
    setConfirmOpen(false)
    setStep('importing')
    setUploadPct(0)
    try {
      const importResult = await importBackup(
        file,
        {
          mode,
          defaultStrategy,
          perConflict: resolvableConflicts.map(c => ({
            id: c.id,
            strategy: resolutions[c.id] ?? c.suggestedStrategy,
          })),
          preferBackupPrimary: false,
          atomic: true,
        },
        needsPassword ? password : undefined,
        pct => setUploadPct(pct),
      )
      setResult(importResult)
      setStep('result')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Restore failed')
      setStep('review')
    }
  }

  function finish() {
    clearApiCache()
    onClose()
  }

  return (
    <WizardShell steps={STEPS} currentIndex={stepIndex(step)} onClose={onClose} closeDisabled={busy}>
      {step === 'select-file' && (
        <div
          key="select-file"
          className="space-y-6 animate-in fade-in slide-in-from-right-6 duration-300 motion-reduce:animate-none"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Restore a backup</h1>
            <p className="text-sm text-muted-foreground">
              Upload a backup archive to review and restore it.
            </p>
          </div>

          <FileDropzone
            file={file}
            onFile={f => {
              setFile(f)
              setNeedsPassword(false)
              setPassword('')
              setPasswordError(null)
            }}
          />

          {needsPassword && (
            <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
              <Label htmlFor="restore-pw" className="flex items-center gap-2 text-sm">
                <Lock className="size-4" />
                Backup password
              </Label>
              <Input
                id="restore-pw"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter the password used to encrypt this backup"
              />
              {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => setStep('choose-mode')}
              disabled={!file || (needsPassword && password.length === 0)}
            >
              Continue
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 'choose-mode' && (
        <div
          key="choose-mode"
          className="space-y-6 animate-in fade-in slide-in-from-right-6 duration-300 motion-reduce:animate-none"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">How should we restore?</h1>
            <p className="text-sm text-muted-foreground">
              Choose how the backup combines with your current data.
            </p>
          </div>

          <div className="grid gap-3">
            <ModeCard
              active={mode === 'merge'}
              onClick={() => setMode('merge')}
              icon={<GitMerge className="size-5" />}
              title="Merge into current data"
              description="Import the backup alongside what's here. You'll review and resolve any conflicts before anything is written."
            />
            <ModeCard
              active={mode === 'replace'}
              onClick={() => setMode('replace')}
              icon={<Replace className="size-5" />}
              title="Replace everything"
              description="Delete the current data in the backed-up tables, then restore the backup exactly. Destructive — best for an empty instance."
              destructive
            />
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep('select-file')}>
              Back
            </Button>
            <Button onClick={runAnalyze}>
              Analyze backup
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 'analyzing' && (
        <ProgressScreen
          mode="indeterminate"
          title="Analyzing backup"
          statuses={[
            'Reading the archive…',
            'Checking for conflicts…',
            'Comparing with your data…',
            'Preparing the plan…',
          ]}
        />
      )}

      {step === 'review' && analysis && (
        <div
          key="review"
          className="space-y-6 animate-in fade-in slide-in-from-right-6 duration-300 motion-reduce:animate-none"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Review</h1>
            <p className="text-sm text-muted-foreground">
              Here’s what’s in this backup and how it compares with your data.
            </p>
          </div>

          {analysis.warnings.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
              {analysis.warnings.map((warning, index) => (
                <p key={index} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {warning}
                </p>
              ))}
            </div>
          )}

          <TableSummaryGrid tables={analysis.tables} />

          {mode === 'replace' ? (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                Replace mode
              </p>
              <p className="text-sm text-muted-foreground">
                The current contents of these tables will be <strong>permanently deleted</strong> and
                replaced with the backup. This cannot be undone.
              </p>
            </div>
          ) : (
            <ConflictList
              conflicts={resolvableConflicts}
              resolutions={resolutions}
              onResolutionChange={(id, strategy) =>
                setResolutions(prev => ({ ...prev, [id]: strategy }))
              }
              defaultStrategy={defaultStrategy}
              onDefaultStrategyChange={setDefaultStrategy}
              onApplyDefaultToAll={() =>
                setResolutions(() => {
                  const next: Record<string, BackupResolutionStrategy> = {}
                  for (const conflict of resolvableConflicts) {
                    next[conflict.id] = conflict.allowedStrategies.includes(defaultStrategy)
                      ? defaultStrategy
                      : conflict.suggestedStrategy
                  }
                  return next
                })
              }
            />
          )}

          <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-lg sm:border sm:px-4">
            {mode === 'merge' ? (
              <p aria-live="polite" className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{tally.willImport}</span> to import ·{' '}
                <span className="font-medium text-foreground">{tally.willSkip}</span> skipped ·{' '}
                {tally.unchanged} unchanged
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Ready to replace and restore.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('choose-mode')}>
                Back
              </Button>
              <Button
                variant={mode === 'replace' ? 'destructive' : 'default'}
                onClick={() => setConfirmOpen(true)}
              >
                {mode === 'replace' ? 'Replace & restore' : 'Restore'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <ProgressScreen
          mode="determinate"
          value={Math.min(uploadPct, 96)}
          title="Restoring your backup"
          statuses={['Uploading…', 'Restoring users…', 'Restoring wallets & cards…', 'Finalizing…']}
        />
      )}

      {step === 'result' && result && <ResultSummary result={result} onDone={finish} />}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === 'replace' ? 'Replace all data?' : 'Restore this backup?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === 'replace'
                ? 'This permanently deletes the current data in the backed-up tables and replaces it with the backup. This cannot be undone.'
                : 'This writes to the live database and may overwrite existing records based on your choices.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runImport}
              className={cn(
                mode === 'replace' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
              )}
            >
              {mode === 'replace' ? 'Delete & restore' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WizardShell>
  )
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  description,
  destructive = false,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
        active
          ? destructive
            ? 'border-destructive/50 bg-destructive/5'
            : 'border-primary/50 bg-primary/5'
          : 'hover:bg-muted/50',
      )}
    >
      <div className={cn('mt-0.5', destructive ? 'text-destructive' : 'text-primary')}>{icon}</div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}
