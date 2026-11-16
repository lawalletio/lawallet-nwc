import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PollFormDialog,
  type AdminPoll
} from '@/components/admin/polls/poll-form-dialog'

const mocks = vi.hoisted(() => ({ patch: vi.fn() }))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ apiClient: { patch: mocks.patch } })
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const poll = (): AdminPoll => ({
  id: 'p1',
  slug: 'usdt-tech',
  title: 'USDT tech',
  type: 'RANKING',
  options: [
    { id: 'tron', label: 'Tron' },
    { id: 'rgb', label: 'RGB' }
  ],
  allowCustom: true,
  updatable: true,
  status: 'OPEN',
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
  responseCount: 3
})

beforeEach(() => {
  mocks.patch.mockReset().mockResolvedValue(poll())
})

describe('PollFormDialog', () => {
  it('keeps edits when the parent refetches the poll while open', async () => {
    const user = userEvent.setup()
    const props = { open: true, onOpenChange: vi.fn(), onSaved: vi.fn() }
    const { rerender } = render(<PollFormDialog {...props} poll={poll()} />)

    await user.click(screen.getByRole('switch', { name: 'Updatable' }))
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'USDT rails')

    // The dashboard's 10 s refetch hands down a fresh poll object.
    rerender(<PollFormDialog {...props} poll={poll()} />)

    expect(screen.getByRole('switch', { name: 'Updatable' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
    expect(mocks.patch).toHaveBeenCalledWith(
      '/api/admin/polls/p1',
      expect.objectContaining({ title: 'USDT rails', updatable: false })
    )
  })

  it('reseeds from the poll when reopened', async () => {
    const props = { onOpenChange: vi.fn(), onSaved: vi.fn(), poll: poll() }
    const { rerender } = render(<PollFormDialog {...props} open />)
    await userEvent.click(screen.getByRole('switch', { name: 'Updatable' }))

    rerender(<PollFormDialog {...props} open={false} />)
    rerender(<PollFormDialog {...props} open />)

    expect(screen.getByRole('switch', { name: 'Updatable' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
})
