import { NextResponse } from 'next/server'
import { mockCardDesignData } from '@/mocks/card-design'

export async function GET() {
  return NextResponse.json({ count: mockCardDesignData.length })
}
