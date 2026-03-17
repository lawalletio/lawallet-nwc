'use client'

import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { PermissionGuard } from '@/components/admin/permission-guard'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Permission } from '@/lib/auth/permissions'
import { useDesigns, useDesignMutations } from '@/lib/client/hooks/use-designs'

export default function DesignsPage() {
  const { data: designs, loading, refetch } = useDesigns()
  const { importDesigns, loading: importing } = useDesignMutations()

  async function handleImport() {
    try {
      await importDesigns()
      toast.success('Designs imported successfully')
      refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import designs')
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Card Designs"
        subtitle="Manage card design templates"
        actions={
          <PermissionGuard permission={Permission.CARD_DESIGNS_WRITE}>
            <Button size="sm" onClick={handleImport} disabled={importing}>
              {importing ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="mr-2 size-4" />
                  Import Designs
                </>
              )}
            </Button>
          </PermissionGuard>
        }
      />

      <div className="p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full rounded-lg" />
            ))}
          </div>
        ) : !designs?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">No designs found</p>
            <PermissionGuard permission={Permission.CARD_DESIGNS_WRITE}>
              <Button variant="outline" onClick={handleImport} disabled={importing}>
                Import Designs
              </Button>
            </PermissionGuard>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {designs.map((design) => (
              <Card key={design.id} className="overflow-hidden">
                {design.image ? (
                  <div className="aspect-video bg-muted">
                    <img
                      src={design.image}
                      alt={design.description || 'Card design'}
                      className="size-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="aspect-video bg-muted flex items-center justify-center">
                    <span className="text-sm text-muted-foreground">No image</span>
                  </div>
                )}
                <CardContent className="p-4">
                  <p className="text-sm font-medium">
                    {design.description || 'Untitled'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    ID: {design.id}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
