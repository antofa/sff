import { NextResponse } from 'next/server'

const SUPABASE_DISABLED = true

export async function GET() {
  return NextResponse.json({ error: 'Supabase is disabled' }, { status: 503 })
}

export async function POST() {
  return NextResponse.json({ error: 'Supabase is disabled' }, { status: 503 })
}
