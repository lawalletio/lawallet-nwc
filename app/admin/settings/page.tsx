'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Settings, Globe, RefreshCw, CheckCircle, Check, X } from 'lucide-react'
import { useAdmin } from '@/hooks/use-admin'

export default function SettingsPage() {
  const { domain, setDomain } = useAdmin()
  const [settings, setSettings] = useState({
    domain: domain || 'yourdomain.com'
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [domainValidation, setDomainValidation] = useState<{
    isValid: boolean | null
    message: string
  }>({
    isValid: null,
    message: ''
  })
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const validateDomain = async () => {
    setIsValidating(true)
    setDomainValidation({ isValid: null, message: 'Validating...' })
    await new Promise(resolve => setTimeout(resolve, 1500))
    const isValid =
      /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/.test(
        settings.domain
      )
    if (isValid) {
      setDomainValidation({
        isValid: true,
        message: 'Domain is valid and properly configured.'
      })
    } else {
      setDomainValidation({ isValid: false, message: 'Invalid domain format.' })
    }
    setIsValidating(false)
  }

  const handleSaveSettings = async () => {
    setIsSaving(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setDomain(settings.domain)
    setLastSaved(new Date())
    setIsSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-muted-foreground">
            Configure your BoltCard + NWC system
          </p>
        </div>
        {lastSaved && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-500" />
            Last saved: {lastSaved.toLocaleTimeString()}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Globe className="h-5 w-5 text-primary" />
            Domain Configuration
          </CardTitle>
          <CardDescription>
            Configure your Lightning address domain and system settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Lightning Address Domain</Label>
            <div className="flex gap-2">
              <Input
                id="domain"
                value={settings.domain}
                onChange={e => {
                  setSettings(prev => ({ ...prev, domain: e.target.value }))
                  setDomainValidation({ isValid: null, message: '' })
                }}
                placeholder="yourdomain.com"
                className="flex-1"
              />
              <Button
                onClick={validateDomain}
                disabled={isValidating || !settings.domain}
                variant="outline"
              >
                {isValidating ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  'Validate'
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Users will have addresses like: username@{settings.domain}
            </p>
            {domainValidation.message && (
              <Alert
                variant={
                  domainValidation.isValid === true ? 'default' : 'destructive'
                }
                className={
                  domainValidation.isValid === true
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : ''
                }
              >
                {domainValidation.isValid === true ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                <AlertDescription>{domainValidation.message}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSaveSettings} disabled={isSaving}>
          {isSaving ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Settings className="h-4 w-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
