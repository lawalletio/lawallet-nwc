"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useWallet } from "@/providers/wallet"
import { CardService } from "@/services/card-service"
import { ArrowLeft, CreditCard, Power, PowerOff } from "lucide-react"

export default function WalletCardsPage() {
  const { privateKey } = useWallet()
  const router = useRouter()
  const [cards, setCards] = useState<any[]>([])

  useEffect(() => {
    if (!privateKey) {
      router.push("/wallet/login")
    } else {
      // Get cards assigned to this wallet (mock data for now)
      const allCards = CardService.list()
      const userCards = allCards.filter((card) => card.pubkey) // Cards that are linked/assigned
      setCards(userCards)
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  const toggleCardStatus = (cardId: string) => {
    setCards((prevCards) => prevCards.map((card) => (card.id === cardId ? { ...card, ntag424: !card.ntag424 } : card)))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/placeholder.svg?height=1080&width=1920')] opacity-5"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="relative z-10 p-6">
        <div className="max-w-6xl mx-auto space-y-8">
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
                  <p className="text-gray-400">Tap to activate or deactivate</p>
                </div>
              </div>
            </div>
          </div>

          {/* Cards Display */}
          {cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center mb-6">
                <CreditCard className="w-12 h-12 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-white">No cards found</h3>
              <p className="text-gray-400">You don't have any cards assigned yet.</p>
            </div>
          ) : (
            <div className="relative">
              {/* Horizontal scrollable container */}
              <div
                className="flex gap-8 overflow-x-auto pb-8 px-4"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                <style jsx>{`
                  div::-webkit-scrollbar {
                    display: none;
                  }
                `}</style>
                {cards.map((card, index) => (
                  <div
                    key={card.id}
                    className="flex-shrink-0 relative group cursor-pointer"
                    onClick={() => toggleCardStatus(card.id)}
                    style={{
                      transform: `perspective(1000px) rotateY(${index * -5}deg) translateZ(${index * -20}px)`,
                      zIndex: cards.length - index,
                    }}
                  >
                    {/* Card */}
                    <div
                      className={`
                      w-80 h-48 rounded-2xl p-6 shadow-2xl transition-all duration-500 transform
                      ${
                        card.ntag424
                          ? "bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 shadow-purple-500/30"
                          : "bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 shadow-gray-900/50"
                      }
                      hover:scale-105 hover:rotate-0 hover:translateZ-10 hover:shadow-3xl
                      ${card.ntag424 ? "hover:shadow-purple-500/50" : "hover:shadow-gray-700/50"}
                    `}
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              card.ntag424 ? "bg-white/20" : "bg-gray-600/50"
                            }`}
                          >
                            {card.ntag424 ? (
                              <Power className="w-4 h-4 text-white" />
                            ) : (
                              <PowerOff className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                          <Badge
                            variant={card.ntag424 ? "default" : "secondary"}
                            className={
                              card.ntag424
                                ? "bg-green-500/30 text-green-200 border-green-400/50"
                                : "bg-red-500/30 text-red-200 border-red-400/50"
                            }
                          >
                            {card.ntag424 ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <div className="text-white/80 text-xs">BoltCard</div>
                        </div>
                      </div>

                      {/* Card Content */}
                      <div className="space-y-4">
                        <div>
                          <div className="text-white/60 text-xs mb-1">Card Name</div>
                          <div className="text-white text-lg font-semibold">{card.username || "Unnamed Card"}</div>
                        </div>

                        <div>
                          <div className="text-white/60 text-xs mb-1">Public Key</div>
                          <div className="text-white/80 text-sm font-mono">
                            {card.pubkey ? `${card.pubkey.slice(0, 12)}...${card.pubkey.slice(-8)}` : "Not linked"}
                          </div>
                        </div>
                      </div>

                      {/* Card Footer */}
                      <div className="absolute bottom-4 right-6">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-6 h-6 rounded-full ${card.ntag424 ? "bg-white/20" : "bg-gray-600/50"}`}
                          ></div>
                          <div
                            className={`w-8 h-6 rounded-full ${card.ntag424 ? "bg-white/30" : "bg-gray-600/30"}`}
                          ></div>
                        </div>
                      </div>

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-white/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                        <div className="text-white text-sm font-medium">
                          {card.ntag424 ? "Tap to deactivate" : "Tap to activate"}
                        </div>
                      </div>
                    </div>

                    {/* 3D Shadow effect */}
                    <div
                      className="absolute inset-0 bg-black/20 rounded-2xl blur-xl -z-10"
                      style={{
                        transform: "translateY(20px) translateZ(-50px)",
                      }}
                    ></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
