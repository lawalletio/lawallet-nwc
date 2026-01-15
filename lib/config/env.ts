import { z } from 'zod'

/**
 * Environment variable schema with validation
 * This ensures all required environment variables are present and valid
 */
const envSchema = z.object({
  // Node environment
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development')
    .describe('Node environment (development, test, production)'),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .describe('Database connection URL (Prisma format)'),

  // JWT Authentication
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long')
    .optional()
    .describe('Secret key for JWT token signing and verification'),

  // Sendy (Email/Newsletter)
  SENDY_URL: z
    .string()
    .url('SENDY_URL must be a valid URL')
    .optional()
    .describe('Sendy API base URL for waitlist subscriptions'),

  SENDY_LIST_ID: z
    .string()
    .min(1, 'SENDY_LIST_ID must not be empty')
    .optional()
    .describe('Sendy list ID for waitlist subscriptions'),

  SENDY_API_KEY: z
    .string()
    .min(1, 'SENDY_API_KEY must not be empty')
    .optional()
    .describe('Sendy API key for authentication'),

  // Alby Integration
  ALBY_API_URL: z
    .string()
    .url('ALBY_API_URL must be a valid URL')
    .optional()
    .describe('Alby Hub API base URL'),

  ALBY_BEARER_TOKEN: z
    .string()
    .min(1, 'ALBY_BEARER_TOKEN must not be empty')
    .optional()
    .describe('Alby Hub API bearer token for authentication'),

  AUTO_GENERATE_ALBY_SUBACCOUNTS: z
    .string()
    .default('false')
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .describe('Enable automatic Alby subaccount generation for new users'),

  // Server Configuration
  PORT: z
    .string()
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .optional()
    .describe('Server port number (defaults to Next.js default)'),

  // GitHub (for scripts)
  GITHUB_TOKEN: z
    .string()
    .min(1, 'GITHUB_TOKEN must not be empty')
    .optional()
    .describe('GitHub personal access token for API operations'),

  GITHUB_PROJECT_NUMBER: z
    .string()
    .optional()
    .describe('GitHub project number for issue management'),

  // Maintenance Mode
  MAINTENANCE_MODE: z
    .string()
    .default('false')
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .describe('Enable maintenance mode (returns 503 for all requests)')
})

/**
 * Validated environment variables
 * This will throw an error on application startup if required variables are missing or invalid
 */
export type Env = z.infer<typeof envSchema>

let validatedEnv: Env | null = null

/**
 * Validates and returns environment variables
 * @param strict - If true, throws error on validation failure. If false, uses safeParse and returns defaults.
 * @throws {Error} If validation fails and strict is true
 */
export function getEnv(strict: boolean = true): Env {
  if (validatedEnv) {
    return validatedEnv
  }

  // Parse and validate environment variables
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    if (strict) {
      const errors = result.error.errors.map(err => {
        const path = err.path.join('.')
        return `  - ${path}: ${err.message}`
      })

      throw new Error(
        `Environment variable validation failed:\n${errors.join('\n')}\n\n` +
          'Please check your .env file and ensure all required variables are set correctly.'
      )
    } else {
      // In non-strict mode, try to parse with defaults
      // This is useful during build time when not all env vars are available
      const resultWithDefaults = envSchema.safeParse({
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'development',
        DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db'
      })

      if (resultWithDefaults.success) {
        validatedEnv = resultWithDefaults.data
        return validatedEnv
      }

      // If still failing, throw in non-strict mode too for critical errors
      throw new Error(
        `Critical environment variable validation failed: ${result.error.errors[0]?.message}`
      )
    }
  }

  validatedEnv = result.data
  return validatedEnv
}

/**
 * Get a specific environment variable
 * @param key - The environment variable key
 * @returns The environment variable value
 */
export function getEnvVar<K extends keyof Env>(key: K): Env[K] {
  const env = getEnv()
  return env[key]
}
