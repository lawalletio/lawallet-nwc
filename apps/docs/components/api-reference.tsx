'use client'

import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'
import type { OpenAPIObject } from 'openapi3-ts/oas31'

// Scalar's React component takes over its container. Wrap it in a tall box
// so it gets enough room when embedded inside Fumadocs' DocsBody — the
// default height collapses without one.
export function ApiReference({ spec }: { spec: OpenAPIObject }) {
  return (
    <div style={{ minHeight: '80vh' }}>
      <ApiReferenceReact
        configuration={{
          content: spec,
          hideClientButton: true,
        }}
      />
    </div>
  )
}
