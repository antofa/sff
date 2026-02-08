import { Redis } from '@upstash/redis'

export type DeckFallbackUpstashValue = {
  id: string
  [key: string]: unknown
}

const normalizeEnvValue = (value?: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const hasWrappingDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"')
  const hasWrappingSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'")
  if (hasWrappingDoubleQuotes || hasWrappingSingleQuotes) {
    const unquoted = trimmed.slice(1, -1).trim()
    return unquoted || null
  }

  return trimmed
}

const UPSTASH_REDIS_REST_URL =
  normalizeEnvValue(process.env.OG_UPSTASH_REDIS_REST_URL) ||
  normalizeEnvValue(process.env.UPSTASH_REDIS_REST_URL) ||
  null
const UPSTASH_REDIS_REST_TOKEN =
  normalizeEnvValue(process.env.OG_UPSTASH_REDIS_REST_TOKEN) ||
  normalizeEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN) ||
  null

const hasConfig = !!(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN)
let redisClient: Redis | null = null

const getRedis = () => {
  if (!hasConfig) return null
  if (redisClient) return redisClient
  redisClient = new Redis({
    url: UPSTASH_REDIS_REST_URL!,
    token: UPSTASH_REDIS_REST_TOKEN!,
  })
  return redisClient
}

const normalizeDeckId = (value: string) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^deck[_-]?fused[_-]?/i, '')
    .replace(/^deck[_-]?/i, '')
    .replace(/^fused[_-]?/i, '')

const getKey = (deckId: string) => `deck:fallback:${encodeURIComponent(normalizeDeckId(deckId))}`

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const toDeckFallbackValue = (value: unknown): DeckFallbackUpstashValue | null => {
  const record = toRecord(value)
  if (!record) return null
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null

  return {
    ...record,
    id,
  }
}

const sanitizeForStorage = (value: DeckFallbackUpstashValue): DeckFallbackUpstashValue | null => {
  const parsed = toDeckFallbackValue(value)
  if (!parsed) return null

  // Bound potentially large arrays to keep Redis payloads compact.
  const cards = Array.isArray(parsed.cards) ? parsed.cards.slice(0, 32) : undefined
  const myDecks = Array.isArray(parsed.myDecks) ? parsed.myDecks.slice(0, 2) : undefined
  const fusedDeckIds = Array.isArray(parsed.fusedDeckIds) ? parsed.fusedDeckIds.slice(0, 2) : undefined

  return {
    ...parsed,
    cards: cards ?? parsed.cards,
    myDecks: myDecks ?? parsed.myDecks,
    fusedDeckIds: fusedDeckIds ?? parsed.fusedDeckIds,
  }
}

export const isDeckFallbackUpstashCacheConfigured = () => hasConfig

export const getDeckFallbackFromUpstashCache = async (
  deckId: string
): Promise<DeckFallbackUpstashValue | null> => {
  const redis = getRedis()
  if (!redis) return null

  try {
    const raw = await redis.get<string>(getKey(deckId))
    if (!raw || typeof raw !== 'string') return null
    const parsed = JSON.parse(raw) as unknown
    return toDeckFallbackValue(parsed)
  } catch {
    return null
  }
}

export const putDeckFallbackToUpstashCache = async (
  deckId: string,
  value: DeckFallbackUpstashValue,
  options?: { ttlSeconds?: number }
) => {
  const redis = getRedis()
  if (!redis) return

  const payload = sanitizeForStorage(value)
  if (!payload) return

  const ttlSeconds = Math.max(1, options?.ttlSeconds ?? 24 * 60 * 60)
  try {
    await redis.set(getKey(deckId), JSON.stringify(payload), { ex: ttlSeconds })
  } catch {
    // Best-effort cache write; ignore errors.
  }
}
