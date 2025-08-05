'use client'

import { useState } from 'react'
import { BlossomUploader } from '@nostrify/nostrify/uploaders'

export function useUploader() {
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const uploadWithTags = async (file: File) => {
    setIsUploading(true)
    setError(null)

    if (!window.nostr) {
      throw new Error('Nostr extension not available')
    }

    try {
      const uploader = new BlossomUploader({
        servers: ['https://blossom.primal.net/'],
        signer: window.nostr
      })

      const tags = await uploader.upload(file)
      return tags
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Upload failed'))
      throw err
    } finally {
      setIsUploading(false)
    }
  }

  const upload = async (file: File) => {
    const tags = await uploadWithTags(file)
    return tags[0]
  }

  return {
    upload,
    uploadWithTags,
    isUploading,
    error
  }
}
