// Mirrors the mounted I18nProvider's locale for plain helpers (date
// formatting in lib/client/format.ts) that can't call hooks. Kept free of
// imports so /admin, which shares those helpers, never pulls in dictionaries.
// English whenever no wallet provider is mounted.
let activeLocale = 'en'

export function setActiveLocale(locale: string) {
  activeLocale = locale
}

/**
 * BCP 47 tag for `Intl` APIs in the active language — the device's own
 * regional variant when it matches (es-AR keeps its date order), else the
 * bare locale. `undefined` (= device default) for English or on the server.
 */
export function intlLocale(): string | undefined {
  if (activeLocale === 'en' || typeof navigator === 'undefined')
    return undefined
  return (
    navigator.languages?.find(
      tag => tag.toLowerCase().split('-')[0] === activeLocale
    ) ?? activeLocale
  )
}
