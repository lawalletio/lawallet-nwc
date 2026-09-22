/**
 * Display currencies the wallet and the API agree on.
 * Keep this list in the settings-screen order: native units, then fiat.
 * Client display names live next to the catalog in the web app.
 */
export const CURRENCY_CODES = [
  'SAT',
  'BTC',
  'ARS',
  'BRL',
  'CLP',
  'COP',
  'EUR',
  'GBP',
  'JPY',
  'MXN',
  'PEN',
  'USD',
  'UYU',
  'VES'
] as const

export type CurrencyCode = (typeof CURRENCY_CODES)[number]
