import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getConfig } from '@/lib/config'

const waitlistSchema = z.object({
  email: z.string().email('Email must be a valid email address'),
  name: z.string().min(1).optional()
})

export async function POST(req: NextRequest) {
  try {
    // Use non-strict mode since this route only needs optional Sendy configuration
    // and doesn't require DATABASE_URL to check if Sendy is enabled
    const config = getConfig(false)
    console.log('POST request received')
    const payload = await req.json()
    const { email, name } = waitlistSchema.parse(payload)
    console.log('Request body:', { email, name })

    if (!config.sendy.enabled) {
      const missingKeys = [
        !config.sendy.url ? 'SENDY_URL' : null,
        !config.sendy.listId ? 'SENDY_LIST_ID' : null,
        !config.sendy.apiKey ? 'SENDY_API_KEY' : null
      ].filter((key): key is string => Boolean(key))
      const missingMessage =
        missingKeys.length > 0
          ? `Missing Sendy configuration: ${missingKeys.join(', ')}`
          : 'Sendy configuration missing'
      console.error(missingMessage)
      return NextResponse.json(
        { success: false, error: missingMessage },
        { status: 500 }
      )
    }

    const formData = new URLSearchParams()
    formData.append('email', email)
    formData.append('api_key', config.sendy.apiKey!)
    formData.append('list', config.sendy.listId!)
    formData.append('boolean', 'true')
    if (name) formData.append('name', name)
    console.log('Form data:', formData.toString())

    console.log('Sending request to Sendy...')
    const sendyRes = await fetch(`${config.sendy.url}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    })
    const result = await sendyRes.text()
    console.log('Sendy response:', result)

    if (result === '1') {
      console.log('Subscription successful')
      return NextResponse.json({ success: true })
    } else {
      console.error('Subscription failed with result:', result)
      return NextResponse.json(
        { success: false, error: 'Subscription failed.' },
        { status: 400 }
      )
    }
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? 'Invalid request body'
        : err instanceof Error
          ? err.message
          : 'Unknown error'
    if (err instanceof z.ZodError) {
      console.error('Invalid waitlist payload:', err.errors)
    } else {
      console.error('Error in POST handler:', err)
    }
    return NextResponse.json(
      { success: false, error: message },
      { status: err instanceof z.ZodError ? 400 : 500 }
    )
  }
}
