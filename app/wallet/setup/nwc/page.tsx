"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useWallet } from "@/providers/wallet"
import { ArrowLeft, Settings, CheckCircle, AlertCircle, Shield } from "lucide-react"

export default function NwcSetupPage() {
  const [nwcUri, setNwcUriState] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const { setNwcUri } = useWallet()
  const router = useRouter()

  const validateNwcUri = (uri: string): boolean => {
    return uri.startsWith("nostr+walletconnect://") && uri.includes("?")
  }

  const handleSetup = async () => {
    setIsLoading(true)
    setError("")

    if (!nwcUri.trim()) {
      setError("Please enter a NWC URI")
      setIsLoading(false)
      return
    }

    if (!validateNwcUri(nwcUri.trim())) {
      setError("Invalid NWC URI format. It should start with 'nostr+walletconnect://'")
      setIsLoading(false)
      return
    }

    try {
      // Simulate validation
      await new Promise((resolve) => setTimeout(resolve, 1000))

      setNwcUri(nwcUri.trim())

      // Show success and redirect
      setTimeout(() => {
        router.push("/wallet")
      }, 1000)
    } catch (err) {
      setError("Failed to configure NWC. Please check your URI and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/placeholder.svg?height=1080&width=1920')] opacity-5"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="relative z-10 p-6">
        <div className="max-w-md mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.back()}
              className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                NWC Setup
              </h1>
              <p className="text-gray-400 text-sm">Configure Nostr Wallet Connect</p>
            </div>
          </div>

          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-purple-500/25">
                <Settings className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-white text-xl">Nostr Wallet Connect</CardTitle>
              <CardDescription className="text-gray-300">
                Connect your wallet to Nostr applications for seamless payments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="nwc-uri" className="text-white font-medium">
                  NWC Connection URI
                </Label>
                <Textarea
                  id="nwc-uri"
                  placeholder="nostr+walletconnect://..."
                  value={nwcUri}
                  onChange={(e) => setNwcUriState(e.target.value)}
                  className="font-mono text-sm min-h-[120px] bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-purple-500/50 focus:ring-purple-500/25 rounded-xl backdrop-blur-sm"
                />
                <p className="text-xs text-gray-400">Paste the NWC URI from your Lightning wallet or service</p>
              </div>

              <Alert className="bg-orange-500/10 border-orange-500/20 backdrop-blur-sm">
                <Shield className="h-4 w-4 text-orange-400" />
                <AlertDescription className="text-xs text-orange-300">
                  This URI contains sensitive information. Only use URIs from trusted sources.
                </AlertDescription>
              </Alert>

              <Button
                onClick={handleSetup}
                disabled={isLoading || !nwcUri.trim()}
                className="w-full h-12 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:transform-none"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                    Configuring...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5 mr-3" />
                    Configure NWC
                  </>
                )}
              </Button>

              {error && (
                <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 backdrop-blur-sm">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <AlertDescription className="text-red-300">{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="text-center">
            <p className="text-xs text-gray-400">
              NWC allows Nostr applications to request payments from your wallet with your permission
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
