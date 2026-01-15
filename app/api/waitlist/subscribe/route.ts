import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'

export async function POST(req: NextRequest) {
  try {
    // Use non-strict mode since this route only needs optional Sendy configuration
    // and doesn't require DATABASE_URL to check if Sendy is enabled
    const config = getConfig(false)
    console.log('POST request received')
    const { email, name } = await req.json()
    console.log('Request body:', { email, name })

    if (!config.sendy.enabled) {
      console.error('Sendy configuration missing')
      return NextResponse.json(
        { success: false, error: 'Sendy configuration missing.' },
        { status: 500 }
      )
    }
    if (!email || typeof email !== 'string') {
      console.error('Invalid email:', email)
      return NextResponse.json(
        { success: false, error: 'Email is required.' },
        { status: 400 }
      )
    }

    const formData = new URLSearchParams()
    formData.append('email', email)
    formData.append('api_key', config.sendy.apiKey!)
    formData.append('name', name)
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
  } catch (err: any) {
    console.error('Error in POST handler:', err)
    return NextResponse.json(
      { success: false, error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
