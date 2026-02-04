import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const R2_ACCOUNT_ID = process.env.OG_R2_ACCOUNT_ID
const R2_BUCKET = process.env.OG_R2_BUCKET
const R2_ACCESS_KEY_ID = process.env.OG_R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.OG_R2_SECRET_ACCESS_KEY

const hasConfig = !!(R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)

let client: S3Client | null = null

const getClient = () => {
  if (!hasConfig) return null
  if (client) return client
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
  })
  return client
}

const getObjectKey = (deckId: string) => `og/deck/${encodeURIComponent(deckId)}.png`

const streamToBytes = async (body: unknown): Promise<Uint8Array | null> => {
  if (!body) return null
  const streamLike = body as {
    transformToByteArray?: () => Promise<Uint8Array>
    arrayBuffer?: () => Promise<ArrayBuffer>
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>
  }

  if (typeof streamLike.transformToByteArray === 'function') {
    return await streamLike.transformToByteArray()
  }
  if (typeof streamLike.arrayBuffer === 'function') {
    return new Uint8Array(await streamLike.arrayBuffer())
  }
  if (typeof streamLike[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = []
    for await (const chunk of streamLike as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === 'string') {
        chunks.push(new TextEncoder().encode(chunk))
      } else {
        chunks.push(new Uint8Array(chunk))
      }
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    chunks.forEach((chunk) => {
      merged.set(chunk, offset)
      offset += chunk.length
    })
    return merged
  }
  return null
}

export const isOgR2CacheConfigured = () => hasConfig

export const getOgImageFromR2Cache = async (
  deckId: string,
  options?: { maxAgeMs?: number }
): Promise<Uint8Array | null> => {
  const sdk = getClient()
  if (!sdk || !R2_BUCKET) return null

  const key = getObjectKey(deckId)
  const maxAgeMs = Math.max(0, options?.maxAgeMs ?? 0)

  try {
    if (maxAgeMs > 0) {
      const head = await sdk.send(
        new HeadObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      )
      const modifiedAt = head.LastModified?.getTime() || 0
      if (!modifiedAt || Date.now() - modifiedAt > maxAgeMs) {
        return null
      }
    }

    const object = await sdk.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    )
    return await streamToBytes(object.Body)
  } catch {
    return null
  }
}

export const putOgImageToR2Cache = async (deckId: string, imageBytes: Uint8Array) => {
  const sdk = getClient()
  if (!sdk || !R2_BUCKET || !imageBytes || imageBytes.length === 0) return

  try {
    await sdk.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: getObjectKey(deckId),
        Body: imageBytes,
        ContentType: 'image/png',
      })
    )
  } catch {
    // Best-effort cache write; ignore errors.
  }
}

