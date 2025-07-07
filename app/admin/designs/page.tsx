'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Search,
  MoreHorizontal,
  Eye,
  Download,
  Trash2,
  Palette,
  Upload
} from 'lucide-react'
import { useCardDesigns } from '@/providers/card-designs'
import type { CardDesign } from '@/types/card-design'

export default function DesignsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [designs, setDesigns] = useState<CardDesign[]>([])
  const { list } = useCardDesigns()

  useEffect(() => {
    list().then(setDesigns)
  }, [list])

  const filteredDesigns = designs.filter(design =>
    design.description.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Card Designs
          </h1>
          <p className="text-muted-foreground">
            Manage your card design templates and artwork
          </p>
        </div>
        <Button onClick={() => alert('Not implemented yet')}>
          <Upload className="h-4 w-4 mr-2" />
          Upload Design
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search designs..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {filteredDesigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Palette className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 text-foreground">
              No designs found
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? 'No designs match your search criteria.'
                : "You haven't uploaded any designs yet."}
            </p>
            {!searchTerm && (
              <Button>
                <Upload className="h-4 w-4 mr-2" />
                Upload Your First Design
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredDesigns.map(design => (
            <Card
              key={design.id}
              className="transition-all hover:shadow-lg hover:-translate-y-1"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-base text-foreground truncate">
                      Design {design.id}
                    </CardTitle>
                    <CardDescription>
                      Created {design.createdAt.toLocaleDateString()}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={true}>
                        <Eye className="h-4 w-4 mr-2" />
                        Preview
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={true}>
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        disabled={true}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="aspect-[856/540] bg-muted rounded-md overflow-hidden mb-4">
                  <img
                    src={design.imageUrl || '/placeholder.svg'}
                    alt={design.description}
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {design.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
