import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logWithTimestamp } from '@/lib/logger'

type SyncSummary = {
  enabled: boolean
  persistedRegular: number
  skippedRegular: number
  persistedFused: number
  skippedFused: number
  writeBlocked: boolean
  writeBlockedUntil: string | null
}

const ALLOWED_SET_IDS = new Set(['B1', 'B2', 'B3', 'S1', 'S2', 'S3', 'S4', 'D0'])
const DEFAULT_SET_ID = 'D0'
const WRITE_BLOCK_COOLDOWN_MS = 10 * 60 * 1000
const WRITE_BLOCK_ERROR_CODES = new Set(['25006', '53100', '53200'])

let supabaseClient: SupabaseClient<Database> | null | undefined
let writesBlockedUntilMs = 0

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

const formatBlockedUntil = (timestampMs: number): string | null => {
  if (!Number.isFinite(timestampMs) || timestampMs <= Date.now()) return null
  return new Date(timestampMs).toISOString()
}

const getErrorText = (error: unknown): string => {
  if (!error) return ''
  if (typeof error === 'string') return error.toLowerCase()
  if (typeof error === 'object') {
    const candidate = error as Record<string, unknown>
    return [candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
  }
  return String(error).toLowerCase()
}

const getErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object') return ''
  const candidate = error as Record<string, unknown>
  if (typeof candidate.code === 'string') {
    return candidate.code
  }
  return ''
}

const isWriteBlockedError = (error: unknown): boolean => {
  const code = getErrorCode(error)
  if (code && WRITE_BLOCK_ERROR_CODES.has(code)) {
    return true
  }

  const text = getErrorText(error)
  if (!text) return false

  return (
    text.includes('read-only') ||
    text.includes('read only') ||
    text.includes('disk full') ||
    text.includes('database is full') ||
    text.includes('cannot execute insert in a read-only transaction') ||
    text.includes('cannot execute update in a read-only transaction') ||
    text.includes('cannot execute delete in a read-only transaction')
  )
}

const pauseWrites = (reason: unknown): string => {
  writesBlockedUntilMs = Date.now() + WRITE_BLOCK_COOLDOWN_MS
  const blockedUntil = formatBlockedUntil(writesBlockedUntilMs) || 'unknown time'
  const code = getErrorCode(reason)
  const detail = getErrorText(reason) || 'unknown write-block reason'
  logWithTimestamp(
    `[Supabase sync] write operations paused until ${blockedUntil} due to database write-block (${code || 'no-code'}): ${detail}`
  )
  return blockedUntil
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
  const normalizedRegularDecks = Array.isArray(regularDecks) ? regularDecks : []
  const normalizedFusedDecks = Array.isArray(fusedDecks) ? fusedDecks : []

  const client = getSupabaseClient()
  if (!client) {
    return {
      enabled: false,
      persistedRegular: 0,
      skippedRegular: 0,
      persistedFused: 0,
      skippedFused: 0,
      writeBlocked: false,
      writeBlockedUntil: null,
    }
  }

  if (writesBlockedUntilMs > Date.now()) {
    return {
      enabled: true,
      persistedRegular: 0,
      skippedRegular: normalizedRegularDecks.length,
      persistedFused: 0,
      skippedFused: normalizedFusedDecks.length,
      writeBlocked: true,
      writeBlockedUntil: formatBlockedUntil(writesBlockedUntilMs),
    }
  }

  let persistedRegular = 0
  let skippedRegular = 0
  let persistedFused = 0
  let skippedFused = 0

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

  for (const deck of normalizedRegularDecks) {
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
    if (isWriteBlockedError(err)) {
      const blockedUntil = pauseWrites(err)
      return {
        enabled: true,
        persistedRegular: 0,
        skippedRegular: skippedRegular + preparedRegular.length,
        persistedFused: 0,
        skippedFused: normalizedFusedDecks.length,
        writeBlocked: true,
        writeBlockedUntil: blockedUntil,
      }
    }
    logWithTimestamp(`[Supabase sync] cards upsert failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  for (const [index, deck] of preparedRegular.entries()) {
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
      if (isWriteBlockedError(error)) {
        const blockedUntil = pauseWrites(error)
        return {
          enabled: true,
          persistedRegular,
          skippedRegular: skippedRegular + (preparedRegular.length - index),
          persistedFused,
          skippedFused: skippedFused + normalizedFusedDecks.length,
          writeBlocked: true,
          writeBlockedUntil: blockedUntil,
        }
      }
      skippedRegular += 1
      logWithTimestamp(`[Supabase sync] regular deck upsert failed (${deck.deckId}): ${error.message}`)
      continue
    }
    persistedRegular += 1
  }

  for (const [index, deck] of normalizedFusedDecks.entries()) {
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
      if (isWriteBlockedError(error)) {
        const blockedUntil = pauseWrites(error)
        return {
          enabled: true,
          persistedRegular,
          skippedRegular,
          persistedFused,
          skippedFused: skippedFused + (normalizedFusedDecks.length - index),
          writeBlocked: true,
          writeBlockedUntil: blockedUntil,
        }
      }
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
    writeBlocked: false,
    writeBlockedUntil: null,
  }
}
