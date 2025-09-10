'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSettings } from '@/hooks/use-settings'
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
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Settings,
  Globe,
  Users,
  Zap
} from 'lucide-react'

interface WizardData {
  domain: string
  endpoint: string
  isCommunity: boolean
  communityName: string
  albyAutoGenerate: boolean
  albyApiUrl: string
  albyBearerToken: string
}

const bitcoinCommunities = [
  'Bitcoin Beach',
  'Bitcoin Jungle',
  'Bitcoin Lake',
  'Bitcoin Island',
  'Bitcoin Ekasi',
  'Bitcoin Berlin',
  'Bitcoin Tokyo',
  'Bitcoin Amsterdam',
  'Bitcoin Prague',
  'Bitcoin Miami'
]

export default function WizardPage() {
  const router = useRouter()
  const {
    settings,
    updateSettings,
    isLoading: settingsLoading,
    isUpdating: settingsUpdating,
    error: settingsError,
    clearError
  } = useSettings()
  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [wizardData, setWizardData] = useState<WizardData>({
    domain: '',
    endpoint: '',
    isCommunity: false,
    communityName: '',
    albyAutoGenerate: false,
    albyApiUrl: '',
    albyBearerToken: ''
  })

  // Initialize wizard data from settings
  useEffect(() => {
    if (settings) {
      setWizardData({
        domain: settings.domain || '',
        endpoint: settings.endpoint || '',
        isCommunity: settings.is_community === 'true',
        communityName: settings.community_name || '',
        albyAutoGenerate: settings.alby_auto_generate === 'true',
        albyApiUrl: settings.alby_api_url || '',
        albyBearerToken: settings.alby_bearer_token || ''
      })
    }
  }, [settings])

  const updateWizardData = (updates: Partial<WizardData>) => {
    setWizardData(prev => ({ ...prev, ...updates }))
  }

  const validateStep1 = () => {
    if (!wizardData.domain.trim()) {
      setError('Domain is required')
      return false
    }
    if (!wizardData.endpoint.trim()) {
      setError('Endpoint is required')
      return false
    }
    if (wizardData.isCommunity && !wizardData.communityName) {
      setError('Please select a community')
      return false
    }
    return true
  }

  const validateStep2 = () => {
    if (wizardData.albyAutoGenerate) {
      if (!wizardData.albyApiUrl.trim()) {
        setError('Alby API URL is required')
        return false
      }
      if (!wizardData.albyBearerToken.trim()) {
        setError('Alby Bearer Token is required')
        return false
      }
    }
    return true
  }

  const handleNext = () => {
    setError(null)
    clearError() // Clear any previous settings errors

    if (currentStep === 1) {
      if (!validateStep1()) return
      setCurrentStep(2)
    } else if (currentStep === 2) {
      if (!validateStep2()) return
      handleFinish()
    }
  }

  const handleBack = () => {
    setError(null)
    clearError() // Clear any previous settings errors
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleFinish = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Prepare settings data
      const settingsData: Record<string, string> = {
        domain: wizardData.domain.trim(),
        endpoint: wizardData.endpoint.trim(),
        is_community: wizardData.isCommunity.toString(),
        alby_auto_generate: wizardData.albyAutoGenerate.toString()
      }

      // Add community-specific settings
      if (wizardData.isCommunity && wizardData.communityName) {
        settingsData.community_name = wizardData.communityName
      }

      // Add Alby-specific settings
      if (wizardData.albyAutoGenerate) {
        settingsData.alby_api_url = wizardData.albyApiUrl.trim()
        settingsData.alby_bearer_token = wizardData.albyBearerToken.trim()
      }

      // Save settings via settings hook
      await updateSettings(settingsData)

      // Redirect to admin page
      router.push('/admin')
    } catch (err) {
      console.error('Error saving settings:', err)
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsLoading(false)
    }
  }

  const renderStep1 = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Basic Configuration
        </CardTitle>
        <CardDescription>
          Configure your domain and endpoint settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="domain">Domain</Label>
          <Input
            id="domain"
            type="text"
            placeholder="example.com"
            value={wizardData.domain}
            onChange={e => updateWizardData({ domain: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="endpoint">Endpoint</Label>
          <Input
            id="endpoint"
            type="url"
            placeholder="https://api.example.com"
            value={wizardData.endpoint}
            onChange={e => updateWizardData({ endpoint: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Is this a community?
            </Label>
            <p className="text-sm text-muted-foreground">
              Enable community-specific features
            </p>
          </div>
          <Switch
            checked={wizardData.isCommunity}
            onCheckedChange={checked =>
              updateWizardData({
                isCommunity: checked,
                communityName: checked ? wizardData.communityName : ''
              })
            }
          />
        </div>

        {wizardData.isCommunity && (
          <div className="space-y-2">
            <Label htmlFor="community">Select Community</Label>
            <Select
              value={wizardData.communityName}
              onValueChange={value =>
                updateWizardData({ communityName: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a Bitcoin community" />
              </SelectTrigger>
              <SelectContent>
                {bitcoinCommunities.map(community => (
                  <SelectItem key={community} value={community}>
                    {community}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  )

  const renderStep2 = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Alby Integration
        </CardTitle>
        <CardDescription>
          Configure Alby subaccount generation settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Auto-generate Alby subaccounts?</Label>
            <p className="text-sm text-muted-foreground">
              Automatically create Alby subaccounts for new users
            </p>
          </div>
          <Switch
            checked={wizardData.albyAutoGenerate}
            onCheckedChange={checked =>
              updateWizardData({
                albyAutoGenerate: checked,
                albyApiUrl: checked ? wizardData.albyApiUrl : '',
                albyBearerToken: checked ? wizardData.albyBearerToken : ''
              })
            }
          />
        </div>

        {wizardData.albyAutoGenerate && (
          <>
            <div className="space-y-2">
              <Label htmlFor="albyApiUrl">Alby API URL</Label>
              <Input
                id="albyApiUrl"
                type="url"
                placeholder="http://umbrel.local:59000"
                value={wizardData.albyApiUrl}
                onChange={e => updateWizardData({ albyApiUrl: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="albyBearerToken">Alby Bearer Token</Label>
              <Input
                id="albyBearerToken"
                type="password"
                placeholder="Enter your Alby bearer token"
                value={wizardData.albyBearerToken}
                onChange={e =>
                  updateWizardData({ albyBearerToken: e.target.value })
                }
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center mb-8">
      <div className="flex items-center space-x-4">
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep >= 1
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {currentStep > 1 ? <CheckCircle className="h-4 w-4" /> : '1'}
        </div>
        <div
          className={`h-1 w-16 ${currentStep > 1 ? 'bg-primary' : 'bg-muted'}`}
        />
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep >= 2
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          2
        </div>
      </div>
    </div>
  )

  return (
    <div className="container mx-auto py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Settings className="h-8 w-8" />
          Setup Wizard
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure your LaWallet NWC instance
        </p>
      </div>

      {renderStepIndicator()}

      {(error || settingsError) && (
        <Alert className="mb-6" variant="destructive">
          <AlertDescription>{error || settingsError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={
              currentStep === 1 ||
              isLoading ||
              settingsLoading ||
              settingsUpdating
            }
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <Button
            onClick={handleNext}
            disabled={isLoading || settingsLoading || settingsUpdating}
          >
            {isLoading || settingsLoading || settingsUpdating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isLoading || settingsUpdating ? 'Saving...' : 'Loading...'}
              </>
            ) : currentStep === 2 ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Finish Setup
              </>
            ) : (
              <>
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
