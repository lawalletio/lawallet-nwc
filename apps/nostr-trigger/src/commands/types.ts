import { z } from 'zod'

const pubkeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'Must be 64-char hex pubkey')

const relayUrlSchema = z
  .string()
  .regex(/^wss?:\/\/.+/i, 'Must be a ws:// or wss:// URL')

// --- NWC connection -----------------------------------------------------------

export const createNwcSchema = z.object({
  label: z.string().min(1).max(200),
  nwcUri: z.string().min(1),
  ownerUserId: z.string().optional(),
  enabled: z.boolean().default(true)
})
export type CreateNwcInput = z.infer<typeof createNwcSchema>

export const updateNwcSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  relays: z.array(relayUrlSchema).optional()
})
export type UpdateNwcInput = z.infer<typeof updateNwcSchema>

// --- Webhook ------------------------------------------------------------------

export const createWebhookSchema = z.object({
  nwcConnectionId: z.string().min(1),
  url: z.string().url(),
  secret: z.string().min(16).optional(),
  eventKinds: z.array(z.number().int()).default([23196, 23197]),
  enabled: z.boolean().default(true)
})
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>

export const testWebhookSchema = z.object({
  webhookEndpointId: z.string().min(1)
})

// --- Admin --------------------------------------------------------------------

export const addAdminSchema = z.object({
  pubkey: pubkeySchema,
  label: z.string().optional()
})
export type AddAdminInput = z.infer<typeof addAdminSchema>

// --- Zap publish --------------------------------------------------------------

export const publishZapSchema = z.object({
  bolt11: z.string().min(1),
  preimage: z.string().optional(),
  zapRequest: z.object({
    id: z.string(),
    pubkey: pubkeySchema,
    kind: z.literal(9734),
    created_at: z.number().int(),
    tags: z.array(z.array(z.string())),
    content: z.string(),
    sig: z.string()
  }),
  recipientPubkey: pubkeySchema,
  extraRelays: z.array(relayUrlSchema).optional()
})
export type PublishZapInput = z.infer<typeof publishZapSchema>

// --- Discriminated union for Nostr control plane ------------------------------

export const nostrCommandSchema = z.discriminatedUnion('op', [
  z.object({ id: z.string(), op: z.literal('status') }),
  z.object({ id: z.string(), op: z.literal('list_nwc') }),
  z.object({ id: z.string(), op: z.literal('get_nwc'), nwcConnectionId: z.string() }),
  z.object({ id: z.string(), op: z.literal('create_nwc'), params: createNwcSchema }),
  z.object({
    id: z.string(),
    op: z.literal('update_nwc'),
    nwcConnectionId: z.string(),
    params: updateNwcSchema
  }),
  z.object({ id: z.string(), op: z.literal('delete_nwc'), nwcConnectionId: z.string() }),
  z.object({
    id: z.string(),
    op: z.literal('list_webhooks'),
    nwcConnectionId: z.string()
  }),
  z.object({ id: z.string(), op: z.literal('create_webhook'), params: createWebhookSchema }),
  z.object({ id: z.string(), op: z.literal('delete_webhook'), webhookEndpointId: z.string() }),
  z.object({ id: z.string(), op: z.literal('test_webhook'), webhookEndpointId: z.string() }),
  z.object({ id: z.string(), op: z.literal('list_relays') }),
  z.object({ id: z.string(), op: z.literal('reload_relays') }),
  z.object({ id: z.string(), op: z.literal('list_admins') }),
  z.object({ id: z.string(), op: z.literal('add_admin'), params: addAdminSchema }),
  z.object({ id: z.string(), op: z.literal('remove_admin'), adminId: z.string() }),
  z.object({
    id: z.string(),
    op: z.literal('audit_tail'),
    limit: z.number().int().min(1).max(500).default(100)
  }),
  z.object({ id: z.string(), op: z.literal('publish_zap'), params: publishZapSchema })
])
export type NostrCommand = z.infer<typeof nostrCommandSchema>
