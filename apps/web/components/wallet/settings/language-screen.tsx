'use client'

import { Check, ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import {
  LOCALES,
  matchLocale,
  setLocalePreference,
  useLocalePreference,
  useT,
  type Locale
} from '@/lib/client/i18n'
import { cn } from '@/lib/utils'

export function LanguageScreen() {
  const router = useRouter()
  const t = useT()
  const preference = useLocalePreference()
  const deviceLocale = matchLocale(
    typeof navigator === 'undefined' ? [] : navigator.languages
  )
  const options: { id: Locale | null; label: string; hint?: string }[] = [
    {
      id: null,
      label: t.settings.languageScreen.automatic,
      hint: t.settings.languageScreen.automaticHint(LOCALES[deviceLocale])
    },
    ...(Object.keys(LOCALES) as Locale[]).map(id => ({
      id,
      label: LOCALES[id]
    }))
  ]

  return (
    <div className="flex flex-1 flex-col pb-32">
      <header className="sticky top-0 z-20 grid h-14 grid-cols-3 items-center bg-background/80 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          {t.common.back}
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          {t.settings.language}
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-2 px-4 pt-4">
        <div
          role="radiogroup"
          aria-label={t.settings.language}
          className="flex flex-col overflow-hidden rounded-2xl bg-card"
        >
          {options.map((option, index) => {
            const checked = option.id === preference
            return (
              <button
                key={option.id ?? 'auto'}
                type="button"
                role="radio"
                aria-checked={checked}
                lang={option.id ?? undefined}
                onClick={() => setLocalePreference(option.id)}
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3 px-4 py-2 text-left transition-[background-color,transform] duration-200 ease-out hover:bg-accent/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/70 active:scale-[0.985] active:bg-accent/90 active:duration-75',
                  index < options.length - 1 && 'border-b border-border/40'
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-medium text-foreground">
                    {option.label}
                  </span>
                  {option.hint ? (
                    <span className="text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </span>
                {checked ? (
                  <Check className="size-5 shrink-0 text-foreground" />
                ) : null}
              </button>
            )
          })}
        </div>
      </main>
      <NavTabbar />
    </div>
  )
}
