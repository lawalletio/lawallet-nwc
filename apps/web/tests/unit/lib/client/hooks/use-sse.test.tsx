import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ status: 'authenticated', jwt: 'a.b.c' })
}))

import {
  SSEProvider,
  bumpSSEVersions,
  reconnectDelay,
  useSSEConnected,
  useSSEVersion,
  type SSEEventType
} from '@/lib/client/hooks/use-sse'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, (() => void)[]>()
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn()
  }
  close() {
    this.closed = true
  }
}

const onRender = vi.fn<(type: SSEEventType) => void>()
const renderCount = (type: SSEEventType) =>
  onRender.mock.calls.filter(([t]) => t === type).length

function Probe({ type }: { type: SSEEventType }) {
  onRender(type)
  const v = useSSEVersion(type)
  return <span data-testid={type}>{v}</span>
}

function Connected() {
  return <span data-testid="connected">{String(useSSEConnected())}</span>
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  onRender.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setHidden(false)
})

describe('useSSEVersion store', () => {
  it('re-renders only subscribers of the bumped type', () => {
    const { getByTestId } = render(
      <>
        <Probe type="cards:updated" />
        <Probe type="users:updated" />
      </>
    )
    const cardsBefore = Number(getByTestId('cards:updated').textContent)
    act(() => bumpSSEVersions(['cards:updated']))
    expect(Number(getByTestId('cards:updated').textContent)).toBe(
      cardsBefore + 1
    )
    expect(renderCount('cards:updated')).toBe(2)
    expect(renderCount('users:updated')).toBe(1)
  })

  it('returns 0 for a null type', () => {
    function Null() {
      return <span data-testid="n">{useSSEVersion(null)}</span>
    }
    const { getByTestId } = render(<Null />)
    expect(getByTestId('n').textContent).toBe('0')
  })
})

describe('SSEProvider', () => {
  it('bumps the event type it receives', () => {
    const { getByTestId } = render(
      <SSEProvider>
        <Probe type="addresses:updated" />
        <Connected />
      </SSEProvider>
    )
    const es = FakeEventSource.instances[0]
    expect(es.url).toBe('/api/events?token=a.b.c')
    act(() => es.emit('connected'))
    expect(getByTestId('connected').textContent).toBe('true')

    const before = Number(getByTestId('addresses:updated').textContent)
    act(() => es.emit('addresses:updated'))
    expect(Number(getByTestId('addresses:updated').textContent)).toBe(
      before + 1
    )
  })

  it('bumps every type after a dropped connection reconnects', () => {
    vi.useFakeTimers()
    const { getByTestId } = render(
      <SSEProvider>
        <Probe type="designs:updated" />
      </SSEProvider>
    )
    act(() => FakeEventSource.instances[0].emit('connected'))
    const before = Number(getByTestId('designs:updated').textContent)

    act(() => FakeEventSource.instances[0].onerror?.())
    expect(FakeEventSource.instances[0].closed).toBe(true)
    act(() => vi.advanceTimersByTime(30_000))
    act(() => FakeEventSource.instances[1].emit('connected'))

    expect(Number(getByTestId('designs:updated').textContent)).toBe(before + 1)
  })

  it('does not refetch on a server-initiated recycle', () => {
    const { getByTestId } = render(
      <SSEProvider>
        <Probe type="settings:updated" />
      </SSEProvider>
    )
    act(() => FakeEventSource.instances[0].emit('connected'))
    const before = Number(getByTestId('settings:updated').textContent)

    act(() => FakeEventSource.instances[0].emit('recycle'))
    expect(FakeEventSource.instances).toHaveLength(2)
    act(() => FakeEventSource.instances[1].emit('connected'))

    expect(Number(getByTestId('settings:updated').textContent)).toBe(before)
  })

  it('closes while hidden and reconnects + refetches on return', () => {
    const { getByTestId } = render(
      <SSEProvider>
        <Probe type="vouchers:updated" />
      </SSEProvider>
    )
    act(() => FakeEventSource.instances[0].emit('connected'))
    const before = Number(getByTestId('vouchers:updated').textContent)

    act(() => setHidden(true))
    expect(FakeEventSource.instances[0].closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => setHidden(false))
    expect(FakeEventSource.instances).toHaveLength(2)
    act(() => FakeEventSource.instances[1].emit('connected'))
    expect(Number(getByTestId('vouchers:updated').textContent)).toBe(before + 1)
  })
})

describe('reconnectDelay', () => {
  it('backs off exponentially with jitter, capped at 30s', () => {
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0)
    expect(reconnectDelay(0)).toBe(500)
    expect(reconnectDelay(3)).toBe(4_000)
    random.mockReturnValue(0.999)
    expect(reconnectDelay(10)).toBeLessThanOrEqual(45_000)
    expect(reconnectDelay(10)).toBeGreaterThan(30_000)
    random.mockRestore()
  })
})
