import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchFusedDecksFromAPI } from '@/lib/api'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey)

type PlayerRow = Database['public']['Tables']['player_decks']['Row']
type UserProfileRow = Database['public']['Tables']['user_profiles']['Row']

type PlayerSummary = {
  player_name: string
  display_name: string | null
  discord_username: string | null
  deck_count: number
  last_seen: string | null
  latest_deck_id: string | null
  latest_deck_name: string | null
  // internal tracking for fused preference
  latest_fused_id?: string | null
  latest_fused_name?: string | null
  latest_fused_ts?: number
}

const normalizeTimestamp = (row: PlayerRow): string | null => {
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

    // 1) Получаем пользователей из user_profiles, чтобы показывать их даже без колод
    const profileFilters: string[] = []
    if (player) profileFilters.push(`game_nick.ilike.%${player}%`)
    if (discord) profileFilters.push(`discord_nick.ilike.%${discord}%`)

    let profileQuery = supabase
      .from('user_profiles')
      .select('game_nick, discord_nick, updated_at')
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

    const profileNicks = (profileRows as UserProfileRow[] | null | undefined)?.reduce<string[]>((acc, row) => {
      if (row?.game_nick) acc.push(row.game_nick.trim())
      return acc
    }, []) ?? []

    // 2) Собираем фильтры для player_decks (используем совпадения из профилей при поиске по Discord)
    let matchedPlayersFromProfiles: string[] = []

    // Если ищем по Discord, добавляем совпадения из user_profiles (discord_nick -> game_nick)
    if (discord) {
      matchedPlayersFromProfiles = profileNicks.filter(Boolean).map((v) => v.toLowerCase())
    }

    const escapeValue = (value: string) => `"${value.replace(/"/g, '""')}"`

    let query = supabase
      .from('player_decks')
      .select(
        'player_name, display_name, discord_username, deck_id, deck_name, updated_at, created_at, deck_created_at, is_fused, format, fused_deck_ids',
        { count: 'exact' }
      )
      .order('deck_created_at', { ascending: false })
      .order('created_at', { ascending: false })

    const filters: string[] = []
    if (player) filters.push(`player_name.ilike.%${player}%`)
    if (discord) {
      filters.push(`discord_username.ilike.%${discord}%`)
      if (matchedPlayersFromProfiles.length > 0) {
        const inList = matchedPlayersFromProfiles.map(escapeValue).join(',')
        filters.push(`player_name.in.(${inList})`)
      }
    }
    if (deckId) filters.push(`deck_id.ilike.%${deckId}%`)

    if (filters.length > 0) {
      query = query.or(filters.join(','))
    }

    if (effectiveLimit) {
      query = query.limit(effectiveLimit)
    }

    const { data, error } = await query

    if (error) {
      console.error('[API] /api/players supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to load players' },
        { status: 500 }
      )
    }

    if (!data || data.length === 0) {
      // Если колод нет, но есть профили, возвращаем хотя бы их
      const fromProfilesOnly = (profileRows as UserProfileRow[] | null | undefined)?.map((row) => ({
        player_name: row.game_nick ? row.game_nick.toLowerCase() : 'unknown',
        display_name: row.game_nick ?? 'Unknown',
        discord_username: row.discord_nick ?? null,
        deck_count: 0,
        last_seen: row.updated_at ?? null,
        latest_deck_id: null,
        latest_deck_name: null,
      })) ?? []
      return NextResponse.json({ players: fromProfilesOnly, count: fromProfilesOnly.length })
    }

    const playersMap = new Map<string, PlayerSummary>()

    // Сначала добавим профили (deck_count = 0), чтобы они были в выдаче даже без колод
    if (profileRows && Array.isArray(profileRows)) {
      (profileRows as UserProfileRow[]).forEach((profile) => {
        if (!profile.game_nick) return
        const key = profile.game_nick.toLowerCase()
        if (!playersMap.has(key)) {
          playersMap.set(key, {
            player_name: key,
            display_name: profile.game_nick,
            discord_username: profile.discord_nick ?? null,
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

    // Теперь обрабатываем данные колод и накладываем поверх профилей
    data.forEach((row) => {
      if (!row.player_name) return
      const key = row.player_name.toLowerCase()
      const displayName = row.display_name || row.player_name
      const tsString = normalizeTimestamp(row)
      const ts = tsString ? Date.parse(tsString) : Number.NaN
      const deckIdStr = row.deck_id ? String(row.deck_id) : ''
      const deckIdLower = deckIdStr.toLowerCase()
      const isFusedId = deckIdLower.startsWith('fused_') || deckIdLower.startsWith('deck_fused')
      const isFusedName = typeof row.deck_name === 'string' && row.deck_name.toLowerCase().includes('fused')

      const isFused =
        row.is_fused === true ||
        isFusedId ||
        isFusedName ||
        (typeof row.format === 'string' && row.format.toLowerCase() === 'fused') ||
        (Array.isArray(row.fused_deck_ids) && row.fused_deck_ids.length > 0)

      const existing = playersMap.get(key)

      if (!existing) {
        playersMap.set(key, {
          player_name: row.player_name,
          display_name: displayName,
          discord_username: row.discord_username,
          deck_count: 1,
          last_seen: tsString,
          latest_deck_id: isFused ? (row.deck_id ?? null) : null,
          latest_deck_name: isFused ? (row.deck_name ?? null) : null,
          latest_fused_id: isFused ? (row.deck_id ?? null) : null,
          latest_fused_name: isFused ? (row.deck_name ?? null) : null,
          latest_fused_ts: isFused && !Number.isNaN(ts) ? ts : undefined,
        })
        return
      }

      existing.deck_count += 1
      if (!existing.display_name && displayName) {
        existing.display_name = displayName
      }
      if (!existing.discord_username && row.discord_username) {
        existing.discord_username = row.discord_username
      }

      const existingTs = existing.last_seen ? Date.parse(existing.last_seen) : Number.NaN
      if (!Number.isNaN(ts) && (Number.isNaN(existingTs) || ts > existingTs)) {
        existing.last_seen = tsString
      }

      // Fused предпочтение: храним последнюю fused по времени
      if (isFused) {
        const fusedTs = !Number.isNaN(ts) ? ts : -Infinity
        if (existing.latest_fused_ts === undefined || fusedTs > (existing.latest_fused_ts ?? -Infinity)) {
          existing.latest_fused_ts = fusedTs
          existing.latest_fused_id = row.deck_id ?? existing.latest_fused_id ?? null
          existing.latest_fused_name = row.deck_name ?? existing.latest_fused_name ?? null
          existing.latest_deck_id = existing.latest_fused_id
          existing.latest_deck_name = existing.latest_fused_name
        }
      } else {
        // Если fused ещё не было, временно используем обычную
        if (!existing.latest_fused_id) {
          existing.latest_deck_id = row.deck_id ?? existing.latest_deck_id
          existing.latest_deck_name = row.deck_name ?? existing.latest_deck_name
        }
      }
    })

    // Подтягиваем discord_nick из user_profiles для тех, у кого discord_username ещё не сохранён в player_decks
    const withoutDiscord = Array.from(playersMap.values())
      .filter((p) => !p.discord_username)
      .map((p) => p.player_name)

    if (withoutDiscord.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('game_nick, discord_nick')
        .in('game_nick', withoutDiscord)

      if (!profilesError && profiles) {
        (profiles as UserProfileRow[]).forEach((profile) => {
          const nick = profile.game_nick?.toLowerCase()
          if (!nick) return
          const existing = playersMap.get(nick)
          if (existing && !existing.discord_username && profile.discord_nick) {
            existing.discord_username = profile.discord_nick
          }
        })
      } else if (profilesError) {
        console.error('[API] /api/players user_profiles fill error:', profilesError)
      }
    }

    // Если fused не найден в Supabase, попробуем взять из внешнего API для таких игроков
    const playersNeedingFused = Array.from(playersMap.values()).filter(
      (p) => !p.latest_fused_id // нет fused в Supabase
    )

    if (playersNeedingFused.length > 0) {
      await Promise.all(playersNeedingFused.map(async (player) => {
        try {
          const fusedDecks = await fetchFusedDecksFromAPI(player.player_name)
          if (Array.isArray(fusedDecks) && fusedDecks.length > 0) {
            // Отсортируем по updatedAt/created
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
              entry.latest_fused_name = latest.name || latest.deck_name || 'Fused deck'
              entry.latest_deck_id = entry.latest_fused_id
              entry.latest_deck_name = entry.latest_fused_name
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
      // Сохраняем оба значения; latest_deck_* оставляем как итоговое, но отдаём и latest_fused_* для UI
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
