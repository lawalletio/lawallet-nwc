'use client'

import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/use-settings'
import { communities } from '@/types/community'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CheckCircle,
  Loader2,
  Settings,
  Globe,
  Users,
  Zap,
  Smartphone
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

interface SettingsData {
  enabled: boolean
  domain: string
  endpoint: string
  isCommunity: boolean
  communityId: string
  albyAutoGenerate: boolean
  albyApiUrl: string
  albyBearerToken: string
  externalDeviceKey: string
}

const bitcoinCommunities = communities

export default function SettingsPage() {
  const {
    settings,
    updateSettings,
    isLoading: settingsLoading,
    isUpdating: settingsUpdating,
    error: settingsError,
    clearError
  } = useSettings()
  const [activeTab, setActiveTab] = useState('general')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [settingsData, setSettingsData] = useState<SettingsData>({
    enabled: false,
    domain: '',
    endpoint: '',
    isCommunity: false,
    communityId: '',
    albyAutoGenerate: false,
    albyApiUrl: 'http://albyhub_server_1:8080/api',
    albyBearerToken: '',
    externalDeviceKey: ''
  })

  // Initialize settings data from settings
  useEffect(() => {
    if (settings) {
      setSettingsData({
        enabled: settings.enabled === 'true',
        domain: settings.domain || '',
        endpoint: settings.endpoint || '',
        isCommunity: settings.is_community === 'true',
        communityId: settings.community_id || '',
        albyAutoGenerate: settings.alby_auto_generate === 'true',
        albyApiUrl: settings.alby_api_url || '',
        albyBearerToken: settings.alby_bearer_token || '',
        externalDeviceKey: settings.external_device_key || ''
      })
    }
  }, [settings])

  const updateSettingsData = (updates: Partial<SettingsData>) => {
    setSettingsData(prev => ({ ...prev, ...updates }))
  }

  const generateExternalDeviceKey = () => {
    // Generate 16 random bytes and convert to hex string
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    const key = Array.from(array, byte =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    return key
  }

  const handleGenerateRemoteKey = async () => {
    const newKey = generateExternalDeviceKey()
    updateSettingsData({ externalDeviceKey: newKey })

    // Save the key to settings
    try {
      await updateSettings({ external_device_key: newKey })
    } catch (err) {
      console.error('Error saving external device key:', err)
      setError('Failed to save remote connection key')
    }
  }

  const validateGeneralSettings = () => {
    if (!settingsData.domain.trim()) {
      setError('Domain is required')
      return false
    }
    if (!settingsData.endpoint.trim()) {
      setError('Endpoint is required')
      return false
    }
    return true
  }

  const validateCommunitySettings = () => {
    if (settingsData.isCommunity && !settingsData.communityId) {
      setError('Please select a community')
      return false
    }
    return true
  }

  const validateAlbySettings = () => {
    if (settingsData.albyAutoGenerate) {
      if (!settingsData.albyApiUrl.trim()) {
        setError('Alby API URL is required')
        return false
      }
      if (!settingsData.albyBearerToken.trim()) {
        setError('Alby Bearer Token is required')
        return false
      }
    }
    return true
  }

  const handleSaveSettings = async () => {
    setIsLoading(true)
    setError(null)

    // Validate all settings
    if (
      !validateGeneralSettings() ||
      !validateCommunitySettings() ||
      !validateAlbySettings()
    )
      return

    try {
      // Prepare settings data
      const settingsToSave: Record<string, string> = {
        enabled: settingsData.enabled.toString(),
        domain: settingsData.domain.trim(),
        endpoint: settingsData.endpoint.trim(),
        is_community: settingsData.isCommunity.toString(),
        alby_auto_generate: settingsData.albyAutoGenerate.toString()
      }

      // Add community-specific settings
      if (settingsData.isCommunity && settingsData.communityId) {
        settingsToSave.community_id = settingsData.communityId
      }

      // Add Alby-specific settings
      if (settingsData.albyAutoGenerate) {
        settingsToSave.alby_api_url = settingsData.albyApiUrl.trim()
        settingsToSave.alby_bearer_token = settingsData.albyBearerToken.trim()
      }

      // Save settings via settings hook
      await updateSettings(settingsToSave)

      setError(null)
      clearError()
    } catch (err) {
      console.error('Error saving settings:', err)
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsLoading(false)
    }
  }

  const renderGeneralSettings = () => (
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
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="enabled" className="text-base">
              Enable System
            </Label>
            <p className="text-sm text-muted-foreground">
              Turn on the LaWallet NWC system functionality
            </p>
          </div>
          <Switch
            id="enabled"
            checked={settingsData.enabled}
            onCheckedChange={checked =>
              updateSettingsData({ enabled: checked })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="domain" className="text-sm font-medium">
            Domain
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            Your domain name (e.g., example.com)
          </p>
          <Input
            id="domain"
            type="text"
            placeholder="example.com"
            value={settingsData.domain}
            onChange={e => updateSettingsData({ domain: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="endpoint" className="text-sm font-medium">
            Endpoint
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            Your API endpoint URL
          </p>
          <Input
            id="endpoint"
            type="url"
            placeholder="https://api.example.com"
            value={settingsData.endpoint}
            onChange={e => updateSettingsData({ endpoint: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  )

  const renderCommunitySettings = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Community Configuration
        </CardTitle>
        <CardDescription>
          Configure community-specific features and settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label
              htmlFor="isCommunity"
              className="text-base flex items-center gap-2"
            >
              <Users className="h-4 w-4" />
              Enable Community Features
            </Label>
            <p className="text-sm text-muted-foreground">
              Turn on community-specific functionality and branding
            </p>
          </div>
          <Switch
            id="isCommunity"
            checked={settingsData.isCommunity}
            onCheckedChange={checked =>
              updateSettingsData({
                isCommunity: checked,
                communityId: checked ? settingsData.communityId : ''
              })
            }
          />
        </div>

        {settingsData.isCommunity && (
          <div className="space-y-2">
            <Label htmlFor="community" className="text-sm font-medium">
              Select Community
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Choose which Bitcoin community this instance serves
            </p>
            <Select
              value={settingsData.communityId}
              onValueChange={value =>
                updateSettingsData({ communityId: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a Bitcoin community" />
              </SelectTrigger>
              <SelectContent>
                {bitcoinCommunities.map(community => (
                  <SelectItem key={community.id} value={community.id}>
                    {community.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  )

  const renderAlbySettings = () => (
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
            <Label htmlFor="albyAutoGenerate" className="text-base">
              Auto-generate Alby subaccounts?
            </Label>
            <p className="text-sm text-muted-foreground">
              Automatically create Alby subaccounts for new users
            </p>
          </div>
          <Switch
            id="albyAutoGenerate"
            checked={settingsData.albyAutoGenerate}
            onCheckedChange={checked =>
              updateSettingsData({
                albyAutoGenerate: checked,
                albyApiUrl: checked ? settingsData.albyApiUrl : '',
                albyBearerToken: checked ? settingsData.albyBearerToken : ''
              })
            }
          />
        </div>

        {settingsData.albyAutoGenerate && (
          <>
            <div className="space-y-2">
              <Label htmlFor="albyApiUrl" className="text-sm font-medium">
                Alby API URL
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Your Alby Hub API endpoint
              </p>
              <Input
                id="albyApiUrl"
                type="url"
                placeholder="http://albyhub_server_1:8080/api"
                value={settingsData.albyApiUrl}
                onChange={e =>
                  updateSettingsData({ albyApiUrl: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="albyBearerToken" className="text-sm font-medium">
                Alby Bearer Token
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Authentication token for Alby Hub API access
              </p>
              <Input
                id="albyBearerToken"
                type="password"
                placeholder="Enter your Alby bearer token"
                value={settingsData.albyBearerToken}
                onChange={e =>
                  updateSettingsData({ albyBearerToken: e.target.value })
                }
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )

  const renderRemoteConnectionsSettings = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          Remote Connections
        </CardTitle>
        <CardDescription>
          Configure remote device connections for external access
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {settingsData.externalDeviceKey ? (
          <div className="space-y-4">
            <div className="text-center">
              <Label className="text-base font-medium">
                Scan this QR with your remote device
              </Label>
              <p className="text-sm text-muted-foreground mt-2">
                Use this QR code to connect your remote device to this instance
              </p>
            </div>
            <div className="flex justify-center">
              <div className="p-4 bg-white rounded-lg border-2 border-gray-200">
                <QRCodeSVG
                  value={`${settingsData.endpoint}/api/remote-connections/${settingsData.externalDeviceKey}`}
                  size={240}
                  level="H"
                />
                <input
                  type="text"
                  value={`${settingsData.endpoint}/api/remote-connections/${settingsData.externalDeviceKey}`}
                />
              </div>
            </div>
            <div className="text-center">
              <Button
                variant="outline"
                onClick={handleGenerateRemoteKey}
                disabled={settingsUpdating}
                className="mt-4"
              >
                {settingsUpdating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate New Key'
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-4">
            <div>
              <Label className="text-base font-medium">
                No Remote Connection Key
              </Label>
              <p className="text-sm text-muted-foreground mt-2">
                Generate a key to enable remote device connections
              </p>
            </div>
            <Button
              onClick={handleGenerateRemoteKey}
              disabled={settingsUpdating}
              className="mt-4"
            >
              {settingsUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate Remote Key QR Code'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Settings className="h-8 w-8" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure your LaWallet NWC instance
        </p>
      </div>

      {(error || settingsError) && (
        <Alert className="mb-6" variant="destructive">
          <AlertDescription>{error || settingsError}</AlertDescription>
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="community" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Community
          </TabsTrigger>
          <TabsTrigger value="alby" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Alby Integration
          </TabsTrigger>
          <TabsTrigger value="remote" className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Remote Connections
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          {renderGeneralSettings()}
        </TabsContent>

        <TabsContent value="community" className="space-y-6">
          {renderCommunitySettings()}
        </TabsContent>

        <TabsContent value="alby" className="space-y-6">
          {renderAlbySettings()}
        </TabsContent>

        <TabsContent value="remote" className="space-y-6">
          {renderRemoteConnectionsSettings()}
        </TabsContent>

        <div className="flex justify-end">
          <Button
            onClick={handleSaveSettings}
            disabled={isLoading || settingsLoading || settingsUpdating}
            className="min-w-32"
          >
            {isLoading || settingsLoading || settingsUpdating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </Tabs>
    </div>
  )
}
