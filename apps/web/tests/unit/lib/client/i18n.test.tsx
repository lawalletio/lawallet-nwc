import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import {
  I18nProvider,
  matchLocale,
  setLocalePreference,
  useT
} from '@/lib/client/i18n'
import { setActiveLocale } from '@/lib/client/i18n/active-locale'
import { formatRelativeTime } from '@/lib/client/format'

function Title() {
  return <h1>{useT().settings.title}</h1>
}

describe('i18n', () => {
  beforeEach(() => window.localStorage.clear())

  it('matches the first supported language by base subtag', () => {
    expect(matchLocale(['es-AR', 'en-US'])).toBe('es')
    expect(matchLocale(['fr-FR', 'EN-gb'])).toBe('en')
    expect(matchLocale(['fr', 'de'])).toBe('en')
    expect(matchLocale([])).toBe('en')
  })

  it('defaults to English outside the provider', () => {
    render(<Title />)
    expect(screen.getByRole('heading').textContent).toBe('Settings')
  })

  it('switches language from the stored preference and back', async () => {
    render(
      <I18nProvider>
        <Title />
      </I18nProvider>
    )
    await act(async () => setLocalePreference('es'))
    expect((await screen.findByText('Ajustes')).tagName).toBe('H1')
    expect(document.documentElement.lang).toBe('es')

    await act(async () => setLocalePreference('en'))
    expect(screen.getByRole('heading').textContent).toBe('Settings')
  })

  it('formats relative time in the active language', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000)
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago')
    setActiveLocale('es')
    try {
      expect(formatRelativeTime(fiveMinAgo)).toMatch(/^hace 5/)
    } finally {
      setActiveLocale('en')
    }
  })
})
