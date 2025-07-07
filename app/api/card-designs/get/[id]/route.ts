import { NextResponse } from 'next/server'
import { mockCardDesignData } from '@/mocks/card-design'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const design = mockCardDesignData.find(d => d.id === params.id)
  if (!design) {
    return new NextResponse('Not found', { status: 404 })
  }
  return NextResponse.json(design)
}
