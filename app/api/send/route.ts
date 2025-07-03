import { NextRequest, NextResponse } from 'next/server'

const SENDY_URL = process.env.SENDY_URL
const SENDY_LIST_ID = process.env.ENDY_LIST_ID
const SENDY_API_KEY = process.env.SENDY_API_KEY!

export async function POST(req: NextRequest) {
  try {
    console.log('POST request received')
    const { email, name } = await req.json()
    console.log('Request body:', { email, name })

    console.log('Environment variables:', {
      SENDY_URL,
      SENDY_LIST_ID,
      SENDY_API_KEY
    })

    if (!SENDY_URL || !SENDY_LIST_ID) {
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
    formData.append('api_key', SENDY_API_KEY)
    formData.append('name', name)
    formData.append('list', SENDY_LIST_ID)
    formData.append('boolean', 'true')
    if (name) formData.append('name', name)
    console.log('Form data:', formData.toString())

    console.log('Sending request to Sendy...')
    const sendyRes = await fetch(`${SENDY_URL}/subscribe`, {
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
