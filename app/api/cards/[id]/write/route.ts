import { NextRequest, NextResponse } from 'next/server'
import type { Ntag424WriteData } from '@/types/ntag424'

import { mockCardData } from '@/mocks/card'
import { cardToNtag424WriteData } from '@/lib/ntag424'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Find card by id
  const card = mockCardData.find(card => card.id === params.id)
  if (!card) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 })
  }

  // Example mock data, replace with real logic as needed
  const mockWriteData: Ntag424WriteData = cardToNtag424WriteData(
    mockCardData[0],
    'agustin.masize.com'
  )

  return NextResponse.json(mockWriteData)
}
