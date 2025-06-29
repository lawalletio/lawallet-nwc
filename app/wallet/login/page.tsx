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
import { Wallet, Key, Plus, AlertCircle } from "lucide-react"

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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <Wallet className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold">Lightning Wallet</h1>
          <p className="text-gray-600">Access your wallet or create a new one</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Wallet Access</CardTitle>
            <CardDescription>Choose how you want to access your wallet</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="generate" className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="generate">Generate New</TabsTrigger>
                <TabsTrigger value="import">Import Existing</TabsTrigger>
              </TabsList>

              <TabsContent value="generate" className="space-y-4">
                <div className="text-center space-y-4">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <Plus className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                    <h3 className="font-medium text-blue-900">Create New Wallet</h3>
                    <p className="text-sm text-blue-700 mt-1">
                      Generate a new Lightning wallet with a fresh private key
                    </p>
                  </div>
                  <Button onClick={handleGenerateWallet} disabled={isLoading} className="w-full">
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4 mr-2" />
                        Generate New Wallet
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="import" className="space-y-4">
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 rounded-lg">
                    <Key className="w-8 h-8 text-green-600 mx-auto mb-2" />
                    <h3 className="font-medium text-green-900">Import Existing Wallet</h3>
                    <p className="text-sm text-green-700 mt-1">Import your wallet using your nsec private key</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nsec">Private Key (nsec)</Label>
                    <Input
                      id="nsec"
                      type="password"
                      placeholder="nsec1..."
                      value={nsecInput}
                      onChange={(e) => setNsecInput(e.target.value)}
                      className="font-mono"
                    />
                    <p className="text-xs text-gray-500">Enter your nsec private key to import your wallet</p>
                  </div>

                  <Button onClick={handleImportWallet} disabled={isLoading || !nsecInput.trim()} className="w-full">
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Key className="w-4 h-4 mr-2" />
                        Import Wallet
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="text-center">
          <p className="text-xs text-gray-500">Keep your private key secure. Never share it with anyone.</p>
        </div>
      </div>
    </div>
  )
}
