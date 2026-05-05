// Re-export from @lawallet-nwc/shared so the openapi package and any future
// SDK can consume the same Zod definitions. Keep this shim so existing
// `@/lib/validation/schemas` callers don't need to change.
export * from '@lawallet-nwc/shared'
