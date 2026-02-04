import { Redis } from '@upstash/redis'

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

const getKey = (deckId: string) => `og:image:deck:${encodeURIComponent(deckId)}`

const toBase64 = (value: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < value.length; i += chunkSize) {
    binary += String.fromCharCode(...value.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

const fromBase64 = (base64: string): Uint8Array | null => {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

export const isOgUpstashCacheConfigured = () => hasConfig

export const getOgImageFromUpstashCache = async (deckId: string): Promise<Uint8Array | null> => {
  const redis = getRedis()
  if (!redis) return null
  try {
    const encoded = await redis.get<string>(getKey(deckId))
    if (!encoded || typeof encoded !== 'string') return null
    return fromBase64(encoded)
  } catch {
    return null
  }
}

export const putOgImageToUpstashCache = async (
  deckId: string,
  imageBytes: Uint8Array,
  options?: { ttlSeconds?: number }
) => {
  const redis = getRedis()
  if (!redis || !imageBytes || imageBytes.length === 0) return
  const ttlSeconds = Math.max(1, options?.ttlSeconds ?? 24 * 60 * 60)
  try {
    await redis.set(getKey(deckId), toBase64(imageBytes), { ex: ttlSeconds })
  } catch {
    // Best-effort cache write; ignore errors.
  }
}
