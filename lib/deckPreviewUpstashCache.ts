import { Redis } from '@upstash/redis'

export type DeckPreviewCacheValue = {
  title: string
  description: string
  imageAlt: string
  hasOwner: boolean
  isFused: boolean
}

const normalizeEnvValue = (value?: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
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

const getKey = (cacheKey: string) => `deck:preview:${encodeURIComponent(cacheKey)}`

const isDeckPreviewValue = (value: unknown): value is DeckPreviewCacheValue => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.title === 'string' &&
    typeof record.description === 'string' &&
    typeof record.imageAlt === 'string' &&
    typeof record.hasOwner === 'boolean' &&
    typeof record.isFused === 'boolean'
  )
}

export const isDeckPreviewUpstashCacheConfigured = () => hasConfig

export const getDeckPreviewFromUpstashCache = async (
  cacheKey: string
): Promise<DeckPreviewCacheValue | null> => {
  const redis = getRedis()
  if (!redis) return null

  try {
    const raw = await redis.get<string>(getKey(cacheKey))
    if (!raw || typeof raw !== 'string') return null
    const parsed = JSON.parse(raw) as unknown
    if (!isDeckPreviewValue(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export const putDeckPreviewToUpstashCache = async (
  cacheKey: string,
  value: DeckPreviewCacheValue,
  options?: { ttlSeconds?: number }
) => {
  const redis = getRedis()
  if (!redis || !isDeckPreviewValue(value)) return
  const ttlSeconds = Math.max(1, options?.ttlSeconds ?? 24 * 60 * 60)

  try {
    await redis.set(getKey(cacheKey), JSON.stringify(value), { ex: ttlSeconds })
  } catch {
    // Best-effort cache write; ignore errors.
  }
}
