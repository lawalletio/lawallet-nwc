'use client'

import { useMemo } from 'react'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'

export interface DesignData {
  id: string
  description: string | null
  image: string | null
  createdAt: string
  updatedAt: string
  /** Non-null when the design has been archived. */
  archivedAt: string | null
}

export interface DesignCount {
  count: number
}

// The server emits `imageUrl` and has no `updatedAt`; the admin UI uses
// `image` and expects `updatedAt`. Reshape once here so every consumer
// downstream sees the dashboard-native shape.
interface ApiDesign {
  id: string
  description: string | null
  imageUrl: string | null
  createdAt: string
  archivedAt?: string | null
}

function toDesignData(d: ApiDesign): DesignData {
  return {
    id: d.id,
    description: d.description,
    image: d.imageUrl,
    createdAt: d.createdAt,
    updatedAt: d.createdAt,
    archivedAt: d.archivedAt ?? null,
  }
}

/**
 * Fetch all card designs.
 */
export function useDesigns() {
  const result = useApi<ApiDesign[]>('/api/card-designs/list')
  const data = useMemo(
    () => (result.data ? result.data.map(toDesignData) : null),
    [result.data],
  )
  return { ...result, data }
}

/**
 * Fetch card design count.
 */
export function useDesignCount() {
  return useApi<DesignCount>('/api/card-designs/count')
}

export interface CreateDesignInput {
  description: string
  imageUrl: string
}

export interface UpdateDesignInput {
  description?: string
  imageUrl?: string
  /** Toggle the archive state. Server stamps `archivedAt` accordingly. */
  archived?: boolean
}

/** Result of importing the veintiuno.lat catalog. */
export interface ImportVeintiunoResult {
  success: boolean
  message: string
  imported: number
  updated: number
  total: number
}

/** Result of removing imported veintiuno designs. */
export interface RemoveVeintiunoResult {
  success: boolean
  message: string
  removed: number
  skipped: number
}

/**
 * Mutation hook for importing, creating, and updating designs.
 */
export function useDesignMutations() {
  const importMut = useMutation()
  const importVeintiunoMut = useMutation<void, ImportVeintiunoResult>()
  const removeVeintiunoMut = useMutation<void, RemoveVeintiunoResult>()
  const createMut = useMutation<CreateDesignInput, ApiDesign>()
  const updateMut = useMutation<UpdateDesignInput, ApiDesign>()

  return {
    importDesigns: () => importMut.mutate('post', '/api/card-designs/import'),
    /** Import the full veintiuno.lat catalog (lawallet.io only). */
    importFromVeintiuno: () =>
      importVeintiunoMut.mutate('post', '/api/card-designs/import-veintiuno'),
    /** Remove designs imported from veintiuno (id prefix `veintiuno-`). */
    removeFromVeintiuno: () =>
      removeVeintiunoMut.mutate('del', '/api/card-designs/import-veintiuno'),
    createDesign: (input: CreateDesignInput) =>
      createMut.mutate('post', '/api/card-designs', input).then(toDesignData),
    updateDesign: (id: string, input: UpdateDesignInput) =>
      updateMut
        .mutate(
          'put',
          `/api/card-designs/${encodeURIComponent(id)}`,
          input,
        )
        .then(toDesignData),
    loading:
      importMut.loading ||
      importVeintiunoMut.loading ||
      removeVeintiunoMut.loading ||
      createMut.loading ||
      updateMut.loading,
    importing: importMut.loading,
    importingVeintiuno: importVeintiunoMut.loading,
    removingVeintiuno: removeVeintiunoMut.loading,
    creating: createMut.loading,
    updating: updateMut.loading,
    error:
      importMut.error ??
      importVeintiunoMut.error ??
      removeVeintiunoMut.error ??
      createMut.error ??
      updateMut.error,
  }
}
