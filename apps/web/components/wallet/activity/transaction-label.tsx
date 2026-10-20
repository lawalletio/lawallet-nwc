'use client'

import { useState, type FormEvent } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { useApi, invalidateApiPath } from '@/lib/client/hooks/use-api'
import { TRANSACTION_LABEL_MAX_LENGTH } from '@lawallet-nwc/shared'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter
} from '@/components/ui/card'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface LabelResponse {
  label: string | null
}

export function TransactionLabel({ paymentHash }: { paymentHash: string }) {
  const { apiClient } = useAuth()
  const path = `/api/wallet/transactions/${encodeURIComponent(paymentHash)}/label`
  const { data, loading, error, refetch } = useApi<LabelResponse>(path)
  const [draft, setDraft] = useState<string | null>(null)
  const [savedLabel, setSavedLabel] = useState<string | null | undefined>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const current =
    savedLabel === undefined ? (data?.label ?? '') : (savedLabel ?? '')
  const value = draft ?? current
  const unavailable = loading || !data || Boolean(error)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || unavailable) return
    setSaving(true)
    setSaveError('')
    setMessage('')
    try {
      const saved = await apiClient.put<LabelResponse>(path, { label: value })
      setSavedLabel(saved.label)
      setDraft(null)
      setMessage(saved.label ? 'Tag saved' : 'Tag removed')
      invalidateApiPath(path)
      invalidateApiPath('/api/wallet/transaction-tags')
    } catch {
      setSaveError(
        'Could not save tag. Your changes have not been saved. Try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <Field data-invalid={Boolean(saveError)}>
            <FieldLabel htmlFor="transaction-label">Tag</FieldLabel>
            <Input
              id="transaction-label"
              value={value}
              maxLength={TRANSACTION_LABEL_MAX_LENGTH}
              disabled={unavailable || saving}
              aria-invalid={Boolean(saveError)}
              aria-describedby="transaction-label-description transaction-label-error"
              placeholder="e.g. Groceries, work, travel"
              onChange={event => {
                setDraft(event.target.value)
                setMessage('')
                setSaveError('')
              }}
            />
            <FieldDescription id="transaction-label-description">
              Only you can see this. Not included in shared receipts. Clear it
              to remove it.
            </FieldDescription>
            <FieldError id="transaction-label-error" role="alert">
              {error
                ? 'Could not load your tag. Try again before editing.'
                : saveError}
            </FieldError>
          </Field>
        </CardContent>
        <CardFooter className="gap-3">
          {error ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
            >
              Retry tag
            </Button>
          ) : (
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={unavailable || saving || value.trim() === current}
            >
              {saving ? 'Saving…' : 'Save tag'}
            </Button>
          )}
          <span role="status" className="text-sm text-muted-foreground">
            {message}
          </span>
        </CardFooter>
      </Card>
    </form>
  )
}
