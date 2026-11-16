import { z } from 'zod'
import {
  createPollSchema,
  dismissPollVoterSchema,
  idParam,
  pollOptionSchema,
  pollResponseBodySchema,
  pollSlugParam,
  pollStatusSchema,
  pollTypeSchema,
  pollVoterParam,
  renameCustomAnswerSchema,
  updatePollSchema
} from '@lawallet-nwc/shared'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'

const TAG = 'Polls'

const pollSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string().optional(),
    type: pollTypeSchema,
    options: z.array(pollOptionSchema),
    allowCustom: z.boolean(),
    updatable: z.boolean(),
    status: pollStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .openapi({ description: 'A user preference poll.' })

const adminPollSchema = pollSchema.extend({
  responseCount: z.number().int().nonnegative(),
  lastResponseAt: z.string().datetime().nullable().optional()
})

const pollAnswerSchema = z.object({
  choices: z.array(z.string()),
  updatedAt: z.string().datetime()
})

const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/polls/{slug}',
  tags: [TAG],
  summary: 'Get a poll and your response.',
  description: 'Draft polls answer 404. `response` is null until you answer.',
  operationId: 'polls.get',
  security: protectedSecurity,
  request: { params: pollSlugParam },
  responses: {
    200: inlineJsonResponse(
      'Poll and the caller’s response.',
      z.object({ poll: pollSchema, response: pollAnswerSchema.nullable() })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'put',
  path: '/api/polls/{slug}/response',
  tags: [TAG],
  summary: 'Submit your poll response.',
  description:
    'Each entry is an option id or `custom:<text>` (1–40 chars, only when ' +
    '`allowCustom`). RANKING: an ordered subset of option ids (at least one ' +
    'entry, no duplicates) plus at most one custom entry, in preference ' +
    'order; options left out count as skipped. SINGLE_CHOICE: exactly one ' +
    'entry. TEXT (a free-text question, no options): exactly one ' +
    '`custom:<text>` entry of 1–280 chars, regardless of `allowCustom`. ' +
    '409 `POLL_LOCKED` when a one-time poll was already answered, 409 ' +
    '`POLL_CLOSED` when the poll is not open.',
  operationId: 'polls.respond',
  security: protectedSecurity,
  request: { params: pollSlugParam, body: json(pollResponseBodySchema) },
  responses: {
    200: inlineJsonResponse(
      'Saved response.',
      z.object({ response: pollAnswerSchema })
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'get',
  path: '/api/admin/polls',
  tags: [TAG],
  summary: 'List polls.',
  operationId: 'admin.polls.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Polls with response counts.',
      z.array(adminPollSchema)
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/admin/polls',
  tags: [TAG],
  summary: 'Create a poll.',
  operationId: 'admin.polls.create',
  security: protectedSecurity,
  request: { body: json(createPollSchema) },
  responses: {
    201: inlineJsonResponse('Poll created.', adminPollSchema),
    ...commonErrorResponses,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'get',
  path: '/api/admin/polls/{id}',
  tags: [TAG],
  summary: 'Get a poll.',
  operationId: 'admin.polls.get',
  security: protectedSecurity,
  request: { params: idParam },
  responses: {
    200: inlineJsonResponse('Poll.', adminPollSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'patch',
  path: '/api/admin/polls/{id}',
  tags: [TAG],
  summary: 'Update, publish or close a poll.',
  description:
    'Type and option ids are frozen once the poll has responses (409); ' +
    'labels stay editable.',
  operationId: 'admin.polls.update',
  security: protectedSecurity,
  request: { params: idParam, body: json(updatePollSchema) },
  responses: {
    200: inlineJsonResponse('Poll updated.', adminPollSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'delete',
  path: '/api/admin/polls/{id}',
  tags: [TAG],
  summary: 'Delete a poll and its responses.',
  operationId: 'admin.polls.delete',
  security: protectedSecurity,
  request: { params: idParam },
  responses: {
    200: inlineJsonResponse(
      'Poll deleted.',
      z.object({ success: z.literal(true) })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'get',
  path: '/api/admin/polls/{id}/results',
  tags: [TAG],
  summary: 'Poll results.',
  description:
    '`scores` (RANKING only) is a Borda count: a response with n entries ' +
    'gives n points to its first entry, n-1 to the next, …. Custom answers ' +
    'are tallied lowercased and trimmed; a custom first pick appears in ' +
    '`firstChoice` as `custom:<text>` labelled with its text. Dismissed responses are listed in ' +
    '`voters` with `dismissed: true` but left out of every tally; ' +
    '`dismissed` counts them.',
  operationId: 'admin.polls.results',
  security: protectedSecurity,
  request: { params: idParam },
  responses: {
    200: inlineJsonResponse(
      'Aggregated results and voters.',
      z.object({
        total: z.number().int(),
        dismissed: z.number().int(),
        updatedAt: z.string().datetime().nullable(),
        firstChoice: z.array(
          z.object({ choice: z.string(), label: z.string(), count: z.number() })
        ),
        scores: z.array(
          z.object({
            choice: z.string(),
            label: z.string(),
            points: z.number(),
            skipped: z
              .number()
              .int()
              .describe('Responses that left this option out.'),
            avgPosition: z
              .number()
              .nullable()
              .describe('Mean 1-based position among responses that ranked it.')
          })
        ),
        custom: z.array(
          z.object({
            label: z.string(),
            count: z.number(),
            merged: z
              .array(z.string())
              .optional()
              .describe('Other spellings an admin merged into this answer.')
          })
        ),
        voters: z.array(
          z.object({
            userId: z.string(),
            lightningAddress: z.string().optional(),
            npub: z.string(),
            choices: z.array(z.string()),
            updatedAt: z.string().datetime(),
            dismissed: z.literal(true).optional()
          })
        )
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'patch',
  path: '/api/admin/polls/{id}/voters/{userId}',
  tags: [TAG],
  summary: 'Dismiss or restore a voter.',
  description:
    'A dismissed response stays listed but no longer counts in the results. ' +
    'It stays dismissed if the user answers again; send `dismissed: false` ' +
    'to restore it.',
  operationId: 'admin.polls.dismissVoter',
  security: protectedSecurity,
  request: { params: pollVoterParam, body: json(dismissPollVoterSchema) },
  responses: {
    200: inlineJsonResponse(
      'Updated flag.',
      z.object({ userId: z.string(), dismissed: z.boolean() })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'put',
  path: '/api/admin/polls/{id}/custom-answers',
  tags: [TAG],
  summary: 'Rename or merge a custom answer.',
  description:
    'Renames custom answer `from` (case-insensitive) to `to` in the results. ' +
    'If `to` matches another custom answer the two are tallied together; ' +
    'answers already merged into `from` follow it. Stored responses keep ' +
    'what each voter typed, and later responses with the same text are ' +
    'renamed too.',
  operationId: 'admin.polls.renameCustomAnswer',
  security: protectedSecurity,
  request: { params: idParam, body: json(renameCustomAnswerSchema) },
  responses: {
    200: inlineJsonResponse(
      'The poll’s alias map.',
      z.object({ customAliases: z.record(z.string(), z.string()) })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})
