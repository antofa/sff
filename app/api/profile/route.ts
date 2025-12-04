import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey)

export async function GET() {
  const session = await auth()
  const discordIdRaw = session?.user?.discordId
  const discordId = discordIdRaw ? String(discordIdRaw) : ''
  const discordName = session?.user?.username || session?.user?.name || null
  if (!discordId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('player_profiles')
    .select('*')
    .eq('discord_id', discordId)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fallback: try lookup by discord_name if nothing found (handles legacy rows where discord_id was truncated)
  if (!data && discordName) {
    const { data: legacyProfile, error: legacyError } = await supabase
      .from('player_profiles')
      .select('*')
      .eq('discord_name', discordName)
      .single()

    if (legacyError && legacyError.code !== 'PGRST116') {
      return NextResponse.json({ error: legacyError.message }, { status: 500 })
    }

    if (legacyProfile) {
      return NextResponse.json({ profile: legacyProfile })
    }
  }

  return NextResponse.json({ profile: data ?? null })
}

export async function POST(request: Request) {
  const session = await auth()
  const discordIdRaw = session?.user?.discordId
  const discordId = discordIdRaw ? String(discordIdRaw) : ''
  if (!discordId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const gameNick = typeof body.gameNick === 'string' ? body.gameNick.trim() : ''
  const friendCode = typeof body.friendCode === 'string' ? body.friendCode.trim() : ''
  const discordNick = session?.user?.username || session?.user?.name || null

  const { data, error } = await supabase
    .from('player_profiles')
    .upsert({
      discord_id: discordId,
      player_name: gameNick || null,
      discord_name: discordNick,
      display_name: gameNick || discordNick,
      friend_code: friendCode || null,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ profile: data })
}
