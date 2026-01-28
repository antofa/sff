import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { getCardImageUrl, getForgebornAlternativeUrl } from '@/lib/api'

export const runtime = 'edge'

const resolveForgebornImageUrl = (forgebornId?: string | null) => {
  if (!forgebornId) return null
  const cleanId = String(forgebornId).replace(/_/g, ' ')
  if (cleanId.includes(' ')) {
    return getForgebornAlternativeUrl(cleanId)
  }
  if (cleanId.includes('-')) {
    return getForgebornAlternativeUrl(cleanId)
  }
  return getCardImageUrl(cleanId, 1, true)
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id || ''
  const origin = new URL(request.url).origin

  let forgebornImageUrl: string | null = null

  try {
    const res = await fetch(`${origin}/api/deck/${encodeURIComponent(deckId)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (res.ok) {
      const json = await res.json()
      const deck = json?.deck
      const forgebornId = deck?.forgeborn?.id || deck?.forgebornId || null
      forgebornImageUrl = resolveForgebornImageUrl(forgebornId)
    }
  } catch {
    forgebornImageUrl = null
  }

  let imageData: ArrayBuffer | null = null
  if (forgebornImageUrl) {
    try {
      const imageRes = await fetch(forgebornImageUrl)
      if (imageRes.ok) {
        imageData = await imageRes.arrayBuffer()
      }
    } catch {
      imageData = null
    }
  }

  const toBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }

  const getImageSize = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer)
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const view = new DataView(buffer)
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }

    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1
          continue
        }
        const marker = bytes[offset + 1]
        const length = (bytes[offset + 2] << 8) + bytes[offset + 3]
        const isSof =
          marker === 0xc0 ||
          marker === 0xc1 ||
          marker === 0xc2 ||
          marker === 0xc3 ||
          marker === 0xc5 ||
          marker === 0xc6 ||
          marker === 0xc7 ||
          marker === 0xc9 ||
          marker === 0xca ||
          marker === 0xcb ||
          marker === 0xcd ||
          marker === 0xce ||
          marker === 0xcf
        if (isSof) {
          const height = (bytes[offset + 5] << 8) + bytes[offset + 6]
          const width = (bytes[offset + 7] << 8) + bytes[offset + 8]
          return { width, height }
        }
        if (length <= 0) break
        offset += 2 + length
      }
    }
    return null
  }

  const imageSize = imageData ? getImageSize(imageData) : null
  const shouldRotate = !!imageSize && imageSize.height > imageSize.width
  const imageSrc = imageData ? `data:image/jpeg;base64,${toBase64(imageData)}` : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f172a',
        }}
      >
        <div
          style={{
            width: '1120px',
            height: '550px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {imageSrc ? (
            <img
              src={imageSrc}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                transform: shouldRotate ? 'rotate(-90deg)' : undefined,
                transformOrigin: 'center center',
              }}
            />
          ) : (
            <div
              style={{
                color: '#e2e8f0',
                fontSize: 42,
                fontWeight: 600,
                fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
              }}
            >
              SolForge Fusion Deck
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
