"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useWallet } from "@/providers/wallet"
import { CardService } from "@/services/card-service"
import { ArrowLeft, CreditCard, Calendar, Zap, User, Key, CheckCircle, AlertCircle, Copy, QrCode } from "lucide-react"
import { useParams } from "next/navigation"

export default function WalletCardDetailPage() {
  const { privateKey } = useWallet()
  const router = useRouter()
  const params = useParams()
  const cardId = params.id as string

  useEffect(() => {
    if (!privateKey) {
      router.push("/wallet/login")
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  const card = CardService.getById(cardId)

  if (!card) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-bold text-white mb-2">Card Not Found</h2>
            <p className="text-gray-400 mb-4">The requested card could not be found.</p>
            <Button onClick={() => router.back()} className="bg-purple-600 hover:bg-purple-700">
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/placeholder.svg?height=1080&width=1920')] opacity-5"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="relative z-10 p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.back()}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center shadow-2xl shadow-purple-500/25">
                  <CreditCard className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    {card.username || "Unnamed Card"}
                  </h1>
                  <p className="text-gray-400">Card Details</p>
                </div>
              </div>
            </div>
            <Badge
              variant={card.ntag424 ? "default" : "secondary"}
              className={
                card.ntag424
                  ? "bg-green-500/20 text-green-400 border-green-500/30 px-4 py-2"
                  : "bg-orange-500/20 text-orange-400 border-orange-500/30 px-4 py-2"
              }
            >
              {card.ntag424 ? <CheckCircle className="w-4 h-4 mr-2" /> : <AlertCircle className="w-4 h-4 mr-2" />}
              {card.ntag424 ? "Active" : "Inactive"}
            </Badge>
          </div>

          {/* Card Visual */}
          <Card className="bg-gradient-to-br from-purple-600 to-blue-600 border-0 shadow-2xl shadow-purple-500/25 overflow-hidden">
            <CardContent className="p-8">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white/80 text-sm mb-2">BoltCard</div>
                  <div className="text-2xl font-bold text-white mb-4">{card.username || "Lightning Card"}</div>
                  <div className="font-mono text-white/90 text-lg tracking-wider">
                    {card.pubkey
                      ? `${card.pubkey.slice(0, 4)} ${card.pubkey.slice(4, 8)} ${card.pubkey.slice(8, 12)} ${card.pubkey.slice(12, 16)}`
                      : "•••• •••• •••• ••••"}
                  </div>
                </div>
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                  <Zap className="w-8 h-8 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card Information */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <User className="w-5 h-5" />
                  Card Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400">Card Name</label>
                  <div className="text-white font-medium">{card.username || "Unnamed Card"}</div>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Created</label>
                  <div className="text-white font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {card.createdAt.toLocaleDateString()}
                  </div>
                </div>
                {card.lastUsedAt && (
                  <div>
                    <label className="text-sm text-gray-400">Last Used</label>
                    <div className="text-white font-medium flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      {card.lastUsedAt.toLocaleDateString()}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Key className="w-5 h-5" />
                  Technical Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400">Public Key</label>
                  <div className="text-white font-mono text-sm bg-white/5 p-2 rounded flex items-center justify-between">
                    <span className="truncate">{card.pubkey || "Not linked"}</span>
                    {card.pubkey && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(card.pubkey!)}
                        className="text-gray-400 hover:text-white"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Card ID</label>
                  <div className="text-white font-mono text-sm bg-white/5 p-2 rounded flex items-center justify-between">
                    <span className="truncate">{card.id}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(card.id)}
                      className="text-gray-400 hover:text-white"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400">NFC Status</label>
                  <div className="text-white font-medium">{card.ntag424 ? "Paired & Active" : "Not Paired"}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Actions */}
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white">Card Actions</CardTitle>
              <CardDescription className="text-gray-400">
                Manage your card settings and generate QR codes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button className="bg-purple-600 hover:bg-purple-700">
                  <QrCode className="w-4 h-4 mr-2" />
                  Generate QR Code
                </Button>
                <Button variant="outline" className="bg-white/5 border-white/20 text-white hover:bg-white/10">
                  <Zap className="w-4 h-4 mr-2" />
                  Test Payment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
