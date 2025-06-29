"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWallet } from "@/providers/wallet"
import { generatePrivateKey, nsecToHex, validateNsec } from "@/lib/nostr"
import { Key, Plus, AlertCircle, Zap } from "lucide-react"

export default function WalletLoginPage() {
  const [nsecInput, setNsecInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const { setPrivateKey } = useWallet()
  const router = useRouter()

  const handleGenerateWallet = async () => {
    setIsLoading(true)
    setError("")

    try {
      const privateKeyHex = generatePrivateKey()
      setPrivateKey(privateKeyHex)
      router.push("/wallet")
    } catch (err) {
      setError("Failed to generate wallet. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleImportWallet = async () => {
    setIsLoading(true)
    setError("")

    if (!nsecInput.trim()) {
      setError("Please enter your nsec private key")
      setIsLoading(false)
      return
    }

    if (!validateNsec(nsecInput.trim())) {
      setError("Invalid nsec format. Please check your private key.")
      setIsLoading(false)
      return
    }

    try {
      const privateKeyHex = nsecToHex(nsecInput.trim())
      setPrivateKey(privateKeyHex)
      router.push("/wallet")
    } catch (err) {
      setError("Failed to import wallet. Please check your private key.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/placeholder.svg?height=1080&width=1920')] opacity-5"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="mx-auto w-20 h-20 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-purple-500/25 transform hover:scale-105 transition-all duration-300">
            <Zap className="w-10 h-10 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Lightning Wallet
            </h1>
            <p className="text-gray-400 text-lg">Access your wallet or create a new one</p>
          </div>
        </div>

        <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-white text-2xl">Wallet Access</CardTitle>
            <CardDescription className="text-gray-300">Choose how you want to access your wallet</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Tabs defaultValue="generate" className="space-y-6">
              <TabsList className="grid w-full grid-cols-2 bg-white/5 border-white/10">
                <TabsTrigger
                  value="generate"
                  className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-blue-600 data-[state=active]:text-white text-gray-300"
                >
                  Generate New
                </TabsTrigger>
                <TabsTrigger
                  value="import"
                  className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-blue-600 data-[state=active]:text-white text-gray-300"
                >
                  Import Existing
                </TabsTrigger>
              </TabsList>

              <TabsContent value="generate" className="space-y-6">
                <div className="text-center space-y-6">
                  <div className="p-6 bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-xl border border-purple-500/20 backdrop-blur-sm">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/25">
                      <Plus className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="font-semibold text-white text-lg mb-2">Create New Wallet</h3>
                    <p className="text-gray-300 text-sm">Generate a new Lightning wallet with a fresh private key</p>
                  </div>
                  <Button
                    onClick={handleGenerateWallet}
                    disabled={isLoading}
                    className="w-full h-12 bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 transform hover:scale-[1.02] transition-all duration-200"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Plus className="w-5 h-5 mr-3" />
                        Generate New Wallet
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="import" className="space-y-6">
                <div className="space-y-6">
                  <div className="p-6 bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-xl border border-green-500/20 backdrop-blur-sm">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/25">
                      <Key className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="font-semibold text-white text-lg mb-2 text-center">Import Existing Wallet</h3>
                    <p className="text-gray-300 text-sm text-center">Import your wallet using your nsec private key</p>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="nsec" className="text-white font-medium">
                      Private Key (nsec)
                    </Label>
                    <Input
                      id="nsec"
                      type="password"
                      placeholder="nsec1..."
                      value={nsecInput}
                      onChange={(e) => setNsecInput(e.target.value)}
                      className="font-mono bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-purple-500/50 focus:ring-purple-500/25 h-12 rounded-xl"
                    />
                    <p className="text-xs text-gray-400">Enter your nsec private key to import your wallet</p>
                  </div>

                  <Button
                    onClick={handleImportWallet}
                    disabled={isLoading || !nsecInput.trim()}
                    className="w-full h-12 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-green-500/25 transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:transform-none"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Key className="w-5 h-5 mr-3" />
                        Import Wallet
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            {error && (
              <Alert variant="destructive" className="mt-6 bg-red-500/10 border-red-500/20 backdrop-blur-sm">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <AlertDescription className="text-red-300">{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="text-center">
          <p className="text-xs text-gray-400">Keep your private key secure. Never share it with anyone.</p>
        </div>
      </div>
    </div>
  )
}
