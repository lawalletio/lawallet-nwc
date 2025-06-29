'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Copy,
  Trash2,
  Zap,
  Link,
  CheckCircle,
  XCircle
} from 'lucide-react'
import { LightningAddressService } from '@/services/lightning-address-service'

export default function AddressesPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const addresses = LightningAddressService.list()

  const filteredAddresses = addresses.filter(address =>
    address.username.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const nwcStatusCounts = LightningAddressService.getNWCStatusCounts()

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Lightning Addresses
          </h1>
          <p className="text-muted-foreground">
            Manage Lightning addresses and NWC connections
          </p>
        </div>
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          Add Address
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Addresses
            </CardTitle>
            <Zap className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {LightningAddressService.count()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              With NWC
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {nwcStatusCounts.withNWC}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Without NWC
            </CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {nwcStatusCounts.withoutNWC}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unique Relays
            </CardTitle>
            <Link className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {LightningAddressService.getUniqueRelays().length}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search addresses..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {filteredAddresses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 text-foreground">
              No addresses found
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? 'No addresses match your search criteria.'
                : "You haven't created any Lightning addresses yet."}
            </p>
            {!searchTerm && (
              <Button disabled>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Address
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredAddresses.map(address => (
            <Card
              key={address.username}
              className="transition-all hover:shadow-md"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base text-foreground">
                        {address.username}@yourdomain.com
                      </CardTitle>
                      <Badge
                        variant={address.nwc ? 'default' : 'secondary'}
                        className={
                          address.nwc ? 'bg-green-100 text-green-800' : ''
                        }
                      >
                        {address.nwc ? 'Connected' : 'No NWC'}
                      </Badge>
                    </div>
                    <CardDescription>
                      Created {address.createdAt.toLocaleDateString()}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Address
                      </DropdownMenuItem>
                      {address.nwc && (
                        <DropdownMenuItem>
                          <Copy className="h-4 w-4 mr-2" />
                          Copy NWC
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive focus:text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Pubkey:</p>
                  <p className="font-mono text-xs break-all text-foreground">
                    {address.pubkey}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground flex items-center gap-2">
                    NWC Connection:
                    <Badge
                      variant={address.nwc ? 'default' : 'secondary'}
                      className={
                        address.nwc
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-200 text-gray-600'
                      }
                    >
                      {address.nwc ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
