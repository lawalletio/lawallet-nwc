/**
 * Analytics event names. Categorical only — never carry PII like pubkeys,
 * lightning addresses, NWC strings, invoice content, or amounts.
 */
export const AnalyticsEvent = {
  // Auth
  LOGIN_STARTED: 'login_started',
  LOGIN_SUCCEEDED: 'login_succeeded',
  LOGIN_FAILED: 'login_failed',
  LOGOUT: 'logout',
  // Setup wizard
  SETUP_STARTED: 'setup_started',
  SETUP_STEP_COMPLETED: 'setup_step_completed',
  SETUP_COMPLETED: 'setup_completed',
  // Cards
  CARD_CREATE_STARTED: 'card_create_started',
  CARD_CREATED: 'card_created',
  CARD_PAIRED: 'card_paired',
  CARD_DELETED: 'card_deleted',
  // Addresses
  ADDRESS_CREATED: 'address_created',
  ADDRESS_MODE_CHANGED: 'address_mode_changed',
  ADDRESS_DELETED: 'address_deleted',
  // Designs
  DESIGN_CREATED: 'design_created',
  DESIGN_IMPORTED: 'design_imported',
  DESIGN_UPDATED: 'design_updated',
  // Settings
  SETTINGS_UPDATED: 'settings_updated',
  // Wallet
  WALLET_SEND_STARTED: 'wallet_send_started',
  WALLET_SEND_COMPLETED: 'wallet_send_completed',
  WALLET_RECEIVE_STARTED: 'wallet_receive_started',
  WALLET_RECEIVE_INVOICE_GENERATED: 'wallet_receive_invoice_generated',
  WALLET_RECEIVE_COMPLETED: 'wallet_receive_completed',
  WALLET_SCAN_USED: 'wallet_scan_used',
} as const

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent]
