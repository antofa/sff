import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchFusedDecksFromAPI } from '@/lib/api'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey)

type PlayerRow = Database['public']['Tables']['player_decks']['Row']
type PlayerProfileRow = Database['public']['Tables']['player_profiles']['Row']

type PlayerSummary = {
  user_id: number
  player_name: string
  display_name: string | null
  discord_name: string | null
  discord_username?: string | null
  deck_count: number
  last_seen: string | null
  latest_deck_id: string | null
  latest_deck_name: string | null
  // internal tracking for fused preference
  latest_fused_id?: string | null
  latest_fused_name?: string | null
  latest_fused_ts?: number
}

const normalizeTimestamp = (row: Partial<PlayerRow>): string | null => {
  return row.deck_created_at || row.created_at || row.updated_at || null
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const player = searchParams.get('player')?.trim() || ''
    const discord = searchParams.get('discord')?.trim() || ''
    const deckId = searchParams.get('deckId')?.trim() || ''
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 500) : 200
    const hasFilters = Boolean(player || discord || deckId)
    const effectiveLimit = hasFilters ? limit : undefined

    // 1) Fetch players from player_profiles to show them even without decks
    const profileFilters: string[] = []
    if (player) profileFilters.push(`player_name.ilike.%${player}%`)
    if (discord) profileFilters.push(`discord_name.ilike.%${discord}%`)

    let profileQuery = supabase
      .from('player_profiles')
      .select('player_name, discord_name, display_name, updated_at')
      .order('updated_at', { ascending: false })

    if (effectiveLimit) {
      profileQuery = profileQuery.limit(effectiveLimit)
    }

    if (profileFilters.length > 0) {
      profileQuery = profileQuery.or(profileFilters.join(','))
    }

    const { data: profileRows, error: profileQueryError } = await profileQuery
    if (profileQueryError) {
      console.error('[API] /api/players user_profiles query error:', profileQueryError)
    }

    const profileNicks =
      (profileRows as PlayerProfileRow[] | null | undefined)?.reduce<string[]>((acc, row) => {
        if (row?.player_name) acc.push(row.player_name.trim())
        return acc
      }, []) ?? []

    // 2) Build filters for player_decks (use profile matches when searching by Discord)
    let matchedPlayersFromProfiles: string[] = []

    // When searching by Discord, add matches from player_profiles (discord_name -> player_name)
    if (discord) {
      matchedPlayersFromProfiles = profileNicks.filter(Boolean).map((v) => v.toLowerCase())
    }

    const matchedProfileIds = (profileRows as PlayerProfileRow[] | null | undefined)
      ?.map((row) => row.user_id)
      .filter((id): id is number => typeof id === 'number') ?? []

    // Fetch decks: if filters present, restrict by matched profile ids; otherwise full with limit
    let deckQuery = supabase
      .from('player_decks')
      .select('user_id, deck_id, updated_at', { count: 'exact' })
      .order('updated_at', { ascending: false })

    if (deckId) {
      deckQuery = deckQuery.ilike('deck_id', `%${deckId}%`)
    }

    if (hasFilters) {
      if (matchedProfileIds.length === 0) {
        const fromProfilesOnly =
          (profileRows as PlayerProfileRow[] | null | undefined)?.map((row) => ({
            user_id: row.user_id,
            player_name: row.player_name ? row.player_name.toLowerCase() : 'unknown',
            display_name: row.display_name ?? row.player_name ?? 'Unknown',
            discord_name: row.discord_name ?? null,
            discord_username: row.discord_name ?? null,
            deck_count: 0,
            last_seen: row.updated_at ?? null,
            latest_deck_id: null,
            latest_deck_name: null,
          })) ?? []
        return NextResponse.json({ players: fromProfilesOnly, count: fromProfilesOnly.length })
      }
      deckQuery = deckQuery.in('user_id', matchedProfileIds)
    }

    if (effectiveLimit) {
      deckQuery = deckQuery.limit(effectiveLimit)
    }

    const { data, error } = await deckQuery

    if (error) {
      console.error('[API] /api/players supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to load players' },
        { status: 500 }
      )
    }

    if (!data || data.length === 0) {
      // If no decks but profiles exist, return profiles only
      const fromProfilesOnly =
        (profileRows as PlayerProfileRow[] | null | undefined)?.map((row) => ({
          user_id: row.user_id,
          player_name: row.player_name ? row.player_name.toLowerCase() : 'unknown',
          display_name: row.display_name ?? row.player_name ?? 'Unknown',
          discord_name: row.discord_name ?? null,
          discord_username: row.discord_name ?? null,
          deck_count: 0,
          last_seen: row.updated_at ?? null,
          latest_deck_id: null,
          latest_deck_name: null,
        })) ?? []
      return NextResponse.json({ players: fromProfilesOnly, count: fromProfilesOnly.length })
    }

    const playersMap = new Map<string, PlayerSummary>()

    // Fetch profiles by user_id from found decks
    const userIds = Array.from(
      new Set(
        (data ?? [])
          .map((row) => row.user_id)
          .filter((id): id is number => typeof id === 'number' && !Number.isNaN(id))
      )
    )

    const profileMap = new Map<number, PlayerProfileRow>()
    if (userIds.length > 0) {
      const { data: profilesById, error: profilesByIdError } = await supabase
        .from('player_profiles')
        .select('user_id, player_name, display_name, discord_name')
        .in('user_id', userIds)

      if (!profilesByIdError && profilesById) {
        (profilesById as PlayerProfileRow[]).forEach((p) => {
          if (typeof p.user_id === 'number') {
            profileMap.set(p.user_id, p)
          }
        })
      } else if (profilesByIdError) {
        console.error('[API] /api/players profile by id lookup error:', profilesByIdError)
      }
    }

    // Add profiles first (deck_count = 0) so they appear even without decks
    if (profileRows && Array.isArray(profileRows)) {
      ;(profileRows as PlayerProfileRow[]).forEach((profile) => {
        if (!profile.player_name) return
        const key = profile.player_name.toLowerCase()
        if (!playersMap.has(key)) {
          playersMap.set(key, {
            user_id: profile.user_id,
            player_name: key,
            display_name: profile.display_name ?? profile.player_name,
            discord_name: profile.discord_name ?? null,
            discord_username: profile.discord_name ?? null,
            deck_count: 0,
            last_seen: profile.updated_at ?? null,
            latest_deck_id: null,
            latest_deck_name: null,
            latest_fused_id: null,
            latest_fused_name: null,
            latest_fused_ts: undefined,
          })
        }
      })
    }

    // Process deck data and overlay on profiles
    data.forEach((row) => {
      const profile = row.user_id ? profileMap.get(row.user_id) : undefined
      if (!profile?.player_name) return
      const key = profile.player_name.toLowerCase()
      const displayName = profile.display_name || profile.player_name || null
      const playerNameLower = key
      const discordFromProfile = profile.discord_name
      const tsString = normalizeTimestamp(row)
      const ts = tsString ? Date.parse(tsString) : Number.NaN
      const deckIdStr = row.deck_id ? String(row.deck_id) : ''
      const deckIdLower = deckIdStr.toLowerCase()
      const isFused = deckIdLower.startsWith('fused_') || deckIdLower.startsWith('deck_fused')

      const existing = playersMap.get(playerNameLower)

      if (!existing) {
        playersMap.set(playerNameLower, {
          user_id: row.user_id!,
          player_name: profile?.player_name || row.deck_id,
          display_name: displayName,
          discord_name: discordFromProfile || null,
          discord_username: discordFromProfile || null,
          deck_count: 1,
          last_seen: tsString,
          latest_deck_id: isFused ? (row.deck_id ?? null) : null,
          latest_deck_name: null,
          latest_fused_id: isFused ? (row.deck_id ?? null) : null,
          latest_fused_name: null,
          latest_fused_ts: isFused && !Number.isNaN(ts) ? ts : undefined,
        })
        return
      }

      existing.deck_count += 1
      if (!existing.user_id && row.user_id) {
        existing.user_id = row.user_id
      }
      if (!existing.display_name && displayName) {
        existing.display_name = displayName
      }
      if (!existing.discord_name && discordFromProfile) {
        existing.discord_name = discordFromProfile
        existing.discord_username = discordFromProfile
      }

      const existingTs = existing.last_seen ? Date.parse(existing.last_seen) : Number.NaN
      if (!Number.isNaN(ts) && (Number.isNaN(existingTs) || ts > existingTs)) {
        existing.last_seen = tsString
      }

      // Fused preference: keep the latest fused by timestamp
      if (isFused) {
        const fusedTs = !Number.isNaN(ts) ? ts : -Infinity
        if (existing.latest_fused_ts === undefined || fusedTs > (existing.latest_fused_ts ?? -Infinity)) {
          existing.latest_fused_ts = fusedTs
          existing.latest_fused_id = row.deck_id ?? existing.latest_fused_id ?? null
          existing.latest_deck_id = existing.latest_fused_id
          existing.latest_deck_name = existing.latest_fused_name ?? null
        }
      } else {
        // If no fused yet, temporarily use regular deck
        if (!existing.latest_fused_id) {
          existing.latest_deck_id = row.deck_id ?? existing.latest_deck_id
          existing.latest_deck_name = existing.latest_deck_name ?? null
        }
      }
    })

    // Fill discord_name from player_profiles for those missing discord_name in player_decks
    const withoutDiscord = Array.from(playersMap.values())
      .filter((p) => !p.discord_name)
      .map((p) => p.player_name)

    if (withoutDiscord.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('player_profiles')
        .select('player_name, discord_name, display_name')
        .in('player_name', withoutDiscord)

      if (!profilesError && profiles) {
        (profiles as PlayerProfileRow[]).forEach((profile) => {
          const nick = profile.player_name?.toLowerCase()
          if (!nick) return
          const existing = playersMap.get(nick)
          if (existing && !existing.discord_name && profile.discord_name) {
            existing.discord_name = profile.discord_name
          }
        })
      } else if (profilesError) {
        console.error('[API] /api/players player_profiles fill error:', profilesError)
      }
    }

    // If fused deck is not in Supabase, try fetching from external API for those players
    const playersNeedingFused = Array.from(playersMap.values()).filter(
      (p) => !p.latest_fused_id // no fused deck in Supabase
    )

    if (playersNeedingFused.length > 0) {
      await Promise.all(playersNeedingFused.map(async (player) => {
        try {
          const fusedDecks = await fetchFusedDecksFromAPI(player.player_name)
          if (Array.isArray(fusedDecks) && fusedDecks.length > 0) {
            // Sort by updatedAt/created
            const pickTs = (d: any) => {
              const tsRaw = d.updatedAt || d.UpdatedAt || d.created || d.createdAt || d.CreatedAt
              const ts = tsRaw ? Date.parse(tsRaw) : Number.NaN
              return Number.isNaN(ts) ? -Infinity : ts
            }
            const sorted = fusedDecks
              .map((d) => ({ ...d, _ts: pickTs(d) }))
              .sort((a, b) => (b._ts ?? -Infinity) - (a._ts ?? -Infinity))

            const latest = sorted[0]
            const entry = playersMap.get(player.player_name.toLowerCase())
            if (entry && latest?.id) {
              entry.latest_fused_id = latest.id
              entry.latest_fused_name = latest.name || (latest as any).deck_name || 'Fused deck'
              entry.latest_deck_id = entry.latest_fused_id
              entry.latest_deck_name = entry.latest_fused_name ?? null
              entry.last_seen = entry.last_seen || (latest._ts !== -Infinity ? new Date(latest._ts).toISOString() : null)
            }
          }
        } catch (err) {
          console.warn('[API] /api/players fused fallback error for', player.player_name, err)
        }
      }))
    }

    const players = Array.from(playersMap.values()).map((p) => ({
      ...p,
      discord_name: p.discord_name || p.discord_username || null,
      discord_username: p.discord_name || p.discord_username || null,
      // Keep both values; latest_deck_* is the final, but also return latest_fused_* for UI
      latest_deck_id: p.latest_fused_id ?? p.latest_deck_id,
      latest_deck_name: p.latest_fused_name ?? p.latest_deck_name,
      latest_fused_id: p.latest_fused_id ?? null,
      latest_fused_name: p.latest_fused_name ?? null,
    })).sort((a, b) => {
      const aTs = a.last_seen ? Date.parse(a.last_seen) : -Infinity
      const bTs = b.last_seen ? Date.parse(b.last_seen) : -Infinity
      return bTs - aTs
    })

    return NextResponse.json({ players, count: players.length })
  } catch (error) {
    console.error('[API] /api/players unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
