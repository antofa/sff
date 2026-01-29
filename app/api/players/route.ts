import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_DISABLED = true

export async function GET(_request: NextRequest) {
  return NextResponse.json({ error: 'Supabase is disabled' }, { status: 503 })
}
