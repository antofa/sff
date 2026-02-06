import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logWithTimestamp } from '@/lib/logger'

type SyncSummary = {
  enabled: boolean
  persistedRegular: number
  skippedRegular: number
  persistedFused: number
  skippedFused: number
  profileUpdated: boolean
}

const ALLOWED_SET_IDS = new Set(['B1', 'B2', 'B3', 'S1', 'S2', 'S3', 'S4', 'D0'])
const DEFAULT_SET_ID = 'D0'

let supabaseClient: SupabaseClient<Database> | null | undefined

const getSupabaseClient = (): SupabaseClient<Database> | null => {
  if (supabaseClient !== undefined) {
    return supabaseClient
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    supabaseClient = null
    return supabaseClient
  }

  supabaseClient = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return supabaseClient
}

const toStringOrNull = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text ? text : null
}

const toNumberOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const fallbackCardNameFromId = (id: string): string =>
  id
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const deriveSetFromDeckId = (deckId?: string | null): string | null => {
  if (!deckId) return null
  const lower = deckId.toLowerCase().trim()
  if (lower.startsWith('b1-') || lower.startsWith('b1_')) return 'B1'
  if (lower.startsWith('b2-') || lower.startsWith('b2_')) return 'B2'
  if (lower.startsWith('b3-') || lower.startsWith('b3_')) return 'B3'
  if (lower.startsWith('s1-') || lower.startsWith('s1_')) return 'S1'
  if (lower.startsWith('s2-') || lower.startsWith('s2_')) return 'S2'
  if (lower.startsWith('s3-') || lower.startsWith('s3_')) return 'S3'
  if (lower.startsWith('s4-') || lower.startsWith('s4_')) return 'S4'
  return null
}

const normalizeSetId = (rawSetId: unknown, deckId: string): string => {
  const text = toStringOrNull(rawSetId)
  if (text) {
    const lower = text.toLowerCase()
    if (lower === 'd0' || lower === 's99' || lower === '99') return 'D0'
    if (/^[1-4]$/.test(lower)) return `S${lower}`
    const upper = text.toUpperCase()
    if (ALLOWED_SET_IDS.has(upper)) return upper
  }

  const fromDeckId = deriveSetFromDeckId(deckId)
  if (fromDeckId && ALLOWED_SET_IDS.has(fromDeckId)) return fromDeckId
  return DEFAULT_SET_ID
}

const extractCardEntries = (deck: any): Array<{ cardId: string; cardName: string }> => {
  const cards: any[] =
    (Array.isArray(deck?.cards) && deck.cards) ||
    (deck?.cards && typeof deck.cards === 'object' ? Object.values(deck.cards) : []) ||
    []

  return cards
    .map((card: any) => {
      if (typeof card === 'string') {
        const cardId = toStringOrNull(card)
        if (!cardId) return null
        return {
          cardId,
          cardName: fallbackCardNameFromId(cardId) || cardId,
        }
      }

      if (!card || typeof card !== 'object') return null

      const cardId = toStringOrNull(card.id ?? card.cardId)
      if (!cardId) return null

      const cardName = toStringOrNull(card.name ?? card.title ?? card.cardTitle) || fallbackCardNameFromId(cardId) || cardId

      return { cardId, cardName }
    })
    .filter((card): card is { cardId: string; cardName: string } => Boolean(card))
}

const normalizeExpireDate = (deck: any): string | null => {
  const raw =
    deck?.expireAt ??
    deck?.expire ??
    deck?.expire_at ??
    deck?.expireDate ??
    deck?.expire_date ??
    deck?.pExpiry ??
    null

  const text = toStringOrNull(raw)
  if (!text) return null
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

const extractDeckId = (deck: any): string | null =>
  toStringOrNull(deck?.id ?? deck?.deckId ?? deck?.deck_id)

const extractDeckName = (deck: any): string | null =>
  toStringOrNull(deck?.name ?? deck?.deckName)

const extractForgebornId = (deck: any): string | null =>
  toStringOrNull(deck?.forgebornId ?? deck?.forgeborn?.id)

const extractFusedSourceIds = (deck: any): [string, string] | null => {
  const ordered: string[] = []
  const seen = new Set<string>()
  const add = (val: unknown) => {
    const id = toStringOrNull(val)
    if (!id || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
  }

  if (Array.isArray(deck?.fusedDeckIds)) {
    deck.fusedDeckIds.forEach((id: unknown) => add(id))
  }

  if (ordered.length < 2 && Array.isArray(deck?.myDecks)) {
    deck.myDecks.forEach((source: any) => add(source?.id ?? source?.deckId ?? source?.deck_id))
  }

  if (ordered.length < 2) return null
  return [ordered[0], ordered[1]]
}

const isDuplicateKeyError = (code?: string | null) => code === '23505'

const ensurePlayerProfile = async (
  client: SupabaseClient<Database>,
  playerName: string
): Promise<boolean> => {
  const normalized = playerName.trim()
  if (!normalized) return false

  const nowIso = new Date().toISOString()

  const { data: existing, error: existingError } = await client
    .from('player_profiles')
    .select('user_id, player_name')
    .ilike('player_name', normalized)
    .limit(1)

  if (existingError) {
    throw existingError
  }

  if (Array.isArray(existing) && existing.length > 0) {
    const userId = existing[0].user_id
    const { error: updateErr } = await client
      .from('player_profiles')
      .update({
        player_name: normalized,
        updated_at: nowIso,
      })
      .eq('user_id', userId)

    if (updateErr) throw updateErr
    return true
  }

  const { data: maxRows, error: maxErr } = await client
    .from('player_profiles')
    .select('user_id')
    .order('user_id', { ascending: false })
    .limit(1)

  if (maxErr) throw maxErr

  const baseUserId = ((Array.isArray(maxRows) && maxRows[0]?.user_id) || 0) + 1

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const userId = baseUserId + attempt
    const { error: insertErr } = await client.from('player_profiles').insert({
      user_id: userId,
      discord_id: String(userId),
      player_name: normalized,
      updated_at: nowIso,
    })

    if (!insertErr) return true
    if (!isDuplicateKeyError(insertErr.code)) throw insertErr
  }

  return false
}

const upsertCards = async (
  client: SupabaseClient<Database>,
  cardEntries: Array<{ card_id: string; card_name: string }>
) => {
  if (cardEntries.length === 0) return

  const chunkSize = 500
  for (let i = 0; i < cardEntries.length; i += chunkSize) {
    const chunk = cardEntries.slice(i, i + chunkSize)
    const { error } = await client.from('cards').upsert(chunk, { onConflict: 'card_id' })
    if (error) throw error
  }
}

export const syncDeckSearchToSupabase = async (
  playerName: string,
  regularDecks: any[],
  fusedDecks: any[]
): Promise<SyncSummary> => {
  const client = getSupabaseClient()
  if (!client) {
    return {
      enabled: false,
      persistedRegular: 0,
      skippedRegular: 0,
      persistedFused: 0,
      skippedFused: 0,
      profileUpdated: false,
    }
  }

  let profileUpdated = false
  let persistedRegular = 0
  let skippedRegular = 0
  let persistedFused = 0
  let skippedFused = 0

  try {
    profileUpdated = await ensurePlayerProfile(client, playerName)
  } catch (err) {
    logWithTimestamp(`[Supabase sync] player_profiles upsert failed for "${playerName}": ${err instanceof Error ? err.message : String(err)}`)
  }

  const allCardEntriesMap = new Map<string, string>()
  const preparedRegular: Array<{
    deckId: string
    deckName: string
    faction: string | null
    forgebornId: string | null
    setId: string
    deckScore: number | null
    elo: number | null
    expireDate: string | null
    cardIds: string[]
  }> = []

  for (const deck of Array.isArray(regularDecks) ? regularDecks : []) {
    const deckId = extractDeckId(deck)
    const deckName = extractDeckName(deck)
    if (!deckId || !deckName) {
      skippedRegular += 1
      continue
    }

    const forgebornId = extractForgebornId(deck)
    const cardEntries = extractCardEntries(deck).filter((card) => card.cardId !== forgebornId)
    const cardIds = cardEntries.map((card) => card.cardId).slice(0, 10)

    if (cardIds.length !== 10) {
      skippedRegular += 1
      continue
    }

    cardEntries.forEach((entry) => {
      if (!allCardEntriesMap.has(entry.cardId)) {
        allCardEntriesMap.set(entry.cardId, entry.cardName)
      }
    })

    preparedRegular.push({
      deckId,
      deckName,
      faction: toStringOrNull(deck?.faction),
      forgebornId,
      setId: normalizeSetId(deck?.cardSetId ?? deck?.cardSetNo, deckId),
      deckScore: toNumberOrNull(deck?.deckScore),
      elo: toNumberOrNull(deck?.elo),
      expireDate: normalizeExpireDate(deck),
      cardIds,
    })
  }

  try {
    await upsertCards(
      client,
      Array.from(allCardEntriesMap.entries()).map(([cardId, cardName]) => ({
        card_id: cardId,
        card_name: cardName || cardId,
      }))
    )
  } catch (err) {
    logWithTimestamp(`[Supabase sync] cards upsert failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  for (const deck of preparedRegular) {
    const { error } = await client.rpc('upsert_player_deck', {
      p_deck_id: deck.deckId,
      p_deck_name: deck.deckName,
      p_owner_name: playerName.trim(),
      p_faction: deck.faction,
      p_forgeborn_id: deck.forgebornId,
      p_set_id: deck.setId,
      p_deck_score: deck.deckScore,
      p_elo: deck.elo,
      p_expire_date: deck.expireDate,
      p_card_ids: deck.cardIds,
    })

    if (error) {
      skippedRegular += 1
      logWithTimestamp(`[Supabase sync] regular deck upsert failed (${deck.deckId}): ${error.message}`)
      continue
    }
    persistedRegular += 1
  }

  for (const deck of Array.isArray(fusedDecks) ? fusedDecks : []) {
    const fusedDeckId = extractDeckId(deck)
    const fusedDeckName = extractDeckName(deck)
    const sourceIds = extractFusedSourceIds(deck)

    if (!fusedDeckId || !fusedDeckName || !sourceIds) {
      skippedFused += 1
      continue
    }

    const { error } = await client.rpc('upsert_player_fused_deck', {
      p_fused_deck_id: fusedDeckId,
      p_deck_name: fusedDeckName,
      p_owner_name: playerName.trim(),
      p_source_deck_1_id: sourceIds[0],
      p_source_deck_2_id: sourceIds[1],
    })

    if (error) {
      skippedFused += 1
      logWithTimestamp(`[Supabase sync] fused deck upsert failed (${fusedDeckId}): ${error.message}`)
      continue
    }

    persistedFused += 1
  }

  return {
    enabled: true,
    persistedRegular,
    skippedRegular,
    persistedFused,
    skippedFused,
    profileUpdated,
  }
}
