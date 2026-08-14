import type { EventSourceLike } from '@lawallet-nwc/sdk'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LaWalletProvider, type LaWalletProviderProps } from '../src'

export const ENDPOINT = 'https://instance.test'

type Listener = (event: { data?: string }) => void

/** Injectable EventSource stub — capture instances, emit frames by hand. */
export class StubEventSource implements EventSourceLike {
  static instances: StubEventSource[] = []
  readonly url: string
  closed = false
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    StubEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data })
    }
  }

  static reset() {
    StubEventSource.instances = []
  }
}

export function renderWithProvider(
  ui: ReactNode,
  props?: Partial<LaWalletProviderProps>
) {
  return render(
    <LaWalletProvider
      endpoint={ENDPOINT}
      EventSourceImpl={StubEventSource}
      {...props}
    >
      {ui}
    </LaWalletProvider>
  )
}
