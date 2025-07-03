import { NextRequest, NextResponse } from 'next/server'
import type { Ntag424WriteData } from '@/types/ntag424'

import { mockCardData } from '@/mocks/card'
import { cardToNtag424WriteData } from '@/lib/ntag424'

const domain = process.env.NEXT_PUBLIC_DOMAIN || 'localhost:3000'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Find card by id
  const card = mockCardData.find(card => card.id === params.id)
  if (!card) {
    return NextResponse.json(
      { error: 'Card not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }

  // Example mock data, replace with real logic as needed
  const mockWriteData: Ntag424WriteData = cardToNtag424WriteData(
    mockCardData[0],
    domain
  )

  return NextResponse.json(mockWriteData, {
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  })
}
