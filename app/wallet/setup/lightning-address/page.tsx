"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useWallet } from "@/providers/wallet"
import { ArrowLeft, Zap, CheckCircle } from "lucide-react"

export default function LightningAddressSetupPage() {
  const [username, setUsername] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const { setLightningAddress } = useWallet()
  const router = useRouter()

  const handleSetup = async () => {
    setIsLoading(true)
    setError("")

    if (!username.trim()) {
      setError("Please enter a username")
      setIsLoading(false)
      return
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      setError("Username can only contain letters, numbers, hyphens, and underscores")
      setIsLoading(false)
      return
    }

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const lightningAddress = `${username}@wallet.example.com`
      setLightningAddress(lightningAddress)

      // Show success and redirect
      setTimeout(() => {
        router.push("/wallet")
      }, 1000)
    } catch (err) {
      setError("Failed to register Lightning Address. Please try again.")
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
                Lightning Address Setup
              </h1>
              <p className="text-gray-400 text-sm">Choose your Lightning Address</p>
            </div>
          </div>

          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-blue-500/25">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-white text-xl">Register Username</CardTitle>
              <CardDescription className="text-gray-300">
                Your Lightning Address will be used to receive payments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="username" className="text-white font-medium">
                  Choose Username
                </Label>
                <div className="flex items-center bg-white/5 border border-white/20 rounded-xl overflow-hidden backdrop-blur-sm">
                  <Input
                    id="username"
                    placeholder="satoshi"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    className="border-0 bg-transparent text-white placeholder:text-gray-400 focus:ring-0 h-12"
                  />
                  <div className="px-4 py-3 bg-white/10 text-sm text-gray-300 border-l border-white/20">
                    @wallet.example.com
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Your Lightning Address will be:{" "}
                  <span className="text-white font-mono">{username || "username"}@wallet.example.com</span>
                </p>
              </div>

              <Button
                onClick={handleSetup}
                disabled={isLoading || !username.trim()}
                className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:transform-none"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                    Registering...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5 mr-3" />
                    Register Lightning Address
                  </>
                )}
              </Button>

              {error && (
                <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 backdrop-blur-sm">
                  <AlertDescription className="text-red-300">{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="text-center">
            <p className="text-xs text-gray-400">
              Your Lightning Address will be publicly visible and can be used by anyone to send you payments
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
