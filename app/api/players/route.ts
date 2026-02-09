import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_DISABLED = true

export async function GET(_request: NextRequest) {
  if (SUPABASE_DISABLED) {
    return NextResponse.json(
      {
        players: [],
        total: 0,
        meta: {
          source: 'disabled',
          supabaseEnabled: false,
          reason: 'Supabase is disabled',
        },
      },
      { status: 200 }
    )
  }

  return NextResponse.json({ players: [], total: 0 })
}
