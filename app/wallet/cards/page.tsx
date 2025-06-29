"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useWallet } from "@/providers/wallet"
import { CardService } from "@/services/card-service"
import { ArrowLeft, CreditCard, Search, Zap, Calendar, Nfc, CheckCircle, AlertCircle } from "lucide-react"

export default function WalletCardsPage() {
  const { privateKey } = useWallet()
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    if (!privateKey) {
      router.push("/wallet/login")
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  // Get cards assigned to this wallet (mock data for now)
  const allCards = CardService.list()
  const userCards = allCards.filter((card) => card.pubkey) // Cards that are linked/assigned

  const filteredCards = userCards.filter(
    (card) =>
      card.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      card.pubkey?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

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
                    My Cards
                  </h1>
                  <p className="text-gray-400">Manage your BoltCards</p>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Total Cards</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{userCards.length}</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Active Cards</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{userCards.filter((card) => card.ntag424).length}</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Used This Month</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">
                  {userCards.filter((card) => card.lastUsedAt).length}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search cards..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-gray-400 backdrop-blur-sm"
            />
          </div>

          {/* Cards List */}
          {filteredCards.length === 0 ? (
            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Nfc className="h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-white">No cards found</h3>
                <p className="text-gray-400 mb-4">
                  {searchTerm ? "No cards match your search criteria." : "You don't have any cards assigned yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredCards.map((card) => (
                <Card
                  key={card.id}
                  className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:shadow-purple-500/10 transition-all duration-300 group cursor-pointer"
                  onClick={() => router.push(`/wallet/cards/${card.id}`)}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-8 bg-gradient-to-br from-purple-500/80 to-blue-500/80 rounded flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">{card.username?.charAt(0) || "C"}</span>
                        </div>
                        <div>
                          <CardTitle className="text-white text-lg">{card.username || "Unnamed Card"}</CardTitle>
                          <CardDescription className="text-gray-400">
                            {card.pubkey ? `${card.pubkey.slice(0, 8)}...${card.pubkey.slice(-8)}` : "Not linked"}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge
                        variant={card.ntag424 ? "default" : "secondary"}
                        className={
                          card.ntag424
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-orange-500/20 text-orange-400 border-orange-500/30"
                        }
                      >
                        {card.ntag424 ? (
                          <CheckCircle className="w-3 h-3 mr-1" />
                        ) : (
                          <AlertCircle className="w-3 h-3 mr-1" />
                        )}
                        {card.ntag424 ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-gray-400">
                        <Calendar className="w-4 h-4" />
                        <span>Created {card.createdAt.toLocaleDateString()}</span>
                      </div>
                      {card.lastUsedAt && (
                        <div className="flex items-center gap-2 text-gray-400">
                          <Zap className="w-4 h-4" />
                          <span>Used {card.lastUsedAt.toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
