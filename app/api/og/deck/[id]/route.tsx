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

  const imageSrc = imageData ? `data:image/jpeg;base64,${Buffer.from(imageData).toString('base64')}` : null

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
