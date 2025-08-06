import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: { pubkey: string } }
) {
  try {
    const { pubkey } = params

    if (!pubkey) {
      return NextResponse.json(
        { error: 'Public key is required' },
        { status: 400 }
      )
    }

    // Find user by public key
    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: {
        id: true,
        pubkey: true,
        createdAt: true,
        nwc: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch (error) {
    console.error('Error fetching user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
