import { Redis } from '@upstash/redis'

const normalizeEnvValue = (value?: string | null): string | null => {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
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

const normalizeOwnerName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

const getKey = (deckId: string) => `deck:owner:${encodeURIComponent(normalizeDeckId(deckId))}`

export const isDeckOwnerUpstashCacheConfigured = () => hasConfig

export const getDeckOwnerFromUpstashCache = async (deckId: string): Promise<string | null> => {
  const redis = getRedis()
  if (!redis) return null
  try {
    const owner = await redis.get<string>(getKey(deckId))
    return normalizeOwnerName(owner)
  } catch {
    return null
  }
}

export const putDeckOwnerToUpstashCache = async (
  deckId: string,
  ownerName: string,
  options?: { ttlSeconds?: number }
) => {
  const redis = getRedis()
  if (!redis) return
  const normalizedOwner = normalizeOwnerName(ownerName)
  if (!normalizedOwner) return
  const ttlSeconds = Math.max(1, options?.ttlSeconds ?? 24 * 60 * 60)
  try {
    await redis.set(getKey(deckId), normalizedOwner, { ex: ttlSeconds })
  } catch {
    // Best-effort cache write; ignore errors.
  }
}

export const putDeckOwnersToUpstashCache = async (
  entries: Array<{ deckId: string; ownerName: string }>,
  options?: { ttlSeconds?: number }
) => {
  const redis = getRedis()
  if (!redis || entries.length === 0) return
  const ttlSeconds = Math.max(1, options?.ttlSeconds ?? 24 * 60 * 60)
  const uniqueEntries = new Map<string, string>()

  entries.forEach((entry) => {
    const deckId = entry?.deckId ? normalizeDeckId(entry.deckId) : ''
    const ownerName = normalizeOwnerName(entry?.ownerName)
    if (!deckId || !ownerName) return
    uniqueEntries.set(deckId, ownerName)
  })

  if (uniqueEntries.size === 0) return

  try {
    await Promise.all(
      Array.from(uniqueEntries.entries()).map(([deckId, ownerName]) =>
        redis.set(`deck:owner:${encodeURIComponent(deckId)}`, ownerName, { ex: ttlSeconds })
      )
    )
  } catch {
    // Best-effort cache write; ignore errors.
  }
}
