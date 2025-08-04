'use client'

import { useAdmin } from '@/hooks/use-admin'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CreditCard, Palette, Zap, Activity, Plus, Clock } from 'lucide-react'
import Link from 'next/link'
import { useCards } from '@/providers/card'
import { useLightningAddresses } from '@/providers/lightning-addresses'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { Card as CardType } from '@/types/card'

export default function AdminPage() {
  const { auth } = useAdmin()
  const { list, count, getStatusCounts } = useCards()
  const { list: listAddresses } = useLightningAddresses()
  const router = useRouter()

  // State for async data
  const [cardCount, setCardCount] = useState<number>(0)
  const [statusCounts, setStatusCounts] = useState({
    paired: 0,
    unpaired: 0,
    used: 0,
    unused: 0
  })
  const [recentCards, setRecentCards] = useState<CardType[]>([])
  const [recentAddresses, setRecentAddresses] = useState<any[]>([])

  // Fetch data on component mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [totalCount, counts, cards, addresses] = await Promise.all([
          count(),
          getStatusCounts(),
          list(),
          listAddresses()
        ])

        setCardCount(totalCount)
        setStatusCounts(counts)
        setRecentCards(cards.slice(0, 5))
        setRecentAddresses(addresses.slice(0, 3))
      } catch (error) {
        console.error('Error fetching dashboard data:', error)
      }
    }

    fetchData()
  }, [count, getStatusCounts, list, listAddresses])

  if (!auth) return null

  const stats = [
    {
      title: 'Total Cards',
      value: cardCount,
      description: 'Active payment cards',
      icon: CreditCard
    },
    {
      title: 'Designs',
      value: '—', // Placeholder until CardDesignProvider is refactored
      description: 'Available card designs',
      icon: Palette
    },
    {
      title: 'Lightning Addresses',
      value: '—', // Placeholder until LightningAddressProvider is refactored
      description: 'Configured addresses',
      icon: Zap
    },
    {
      title: 'Active Cards',
      value: statusCounts.paired,
      description: 'Currently paired',
      icon: Activity
    }
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-muted-foreground">
            Welcome back! Here&apos;s an overview of your BoltCard system.
          </p>
        </div>
        <Button
          onClick={() => {
            router.push('/admin/cards/new')
          }}
          className="text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Card
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(stat => (
          <Card
            key={stat.title}
            className="bg-card border transition-all hover:shadow-lg hover:-translate-y-1"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {stat.value}
              </div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-foreground">Recent Cards</CardTitle>
                <CardDescription>
                  Latest cards created in your system
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/cards">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentCards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cards created yet.
              </p>
            ) : (
              <div className="space-y-3">
                {recentCards.map(card => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {card.username || card.pubkey || 'Unpaired'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground truncate">
                          {card.design.description}
                        </p>
                        <div className="flex items-center text-xs text-muted-foreground/70">
                          <Clock className="h-3 w-3 mr-1" />
                          {card.createdAt.toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ml-2 ${card.ntag424 ? 'bg-blue-100 text-blue-800' : 'bg-secondary text-secondary-foreground'}`}
                    >
                      {card.ntag424 ? 'Paired' : 'Unpaired'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-foreground">
                  Lightning Addresses
                </CardTitle>
                <CardDescription>Recent address configurations</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/addresses">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentAddresses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No addresses configured yet.
              </p>
            ) : (
              <div className="space-y-3">
                {recentAddresses.map(address => (
                  <div
                    key={address.username}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {address.username}@yourdomain.com
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {address.pubkey.slice(0, 16)}...
                        </p>
                        <div className="flex items-center text-xs text-muted-foreground/70">
                          <Clock className="h-3 w-3 mr-1" />
                          {address.createdAt.toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ml-2 ${address.nwc ? 'bg-green-100 text-green-800' : 'bg-secondary text-secondary-foreground'}`}
                    >
                      {address.nwc ? 'NWC Connected' : 'No NWC'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
