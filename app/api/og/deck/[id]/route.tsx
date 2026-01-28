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

const formatSetLabel = (value?: string | number | null, fallback?: string | number | null) => {
  const raw = value ?? fallback
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'b1') return 'B1'
  if (lower === 'd0') return 'S99'
  if (/^s\\d+/.test(lower)) return lower.toUpperCase()
  if (/^\\d+$/.test(lower)) return `S${lower}`
  return text.toUpperCase()
}

const countCardTypes = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId

  let creatures = 0
  let spells = 0
  let solbind = 0

  const isForgebornCard = (card: any) => {
    const id = typeof card === 'string' ? card : card?.id
    if (id && forgebornId && String(id).toLowerCase() === String(forgebornId).toLowerCase()) {
      return true
    }
    const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
    const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()
    return typeLower.includes('forgeborn') || rarityLower.includes('forgeborn')
  }

  cards.forEach((card: any) => {
    if (isForgebornCard(card)) return
    const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
    const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()
    if (typeLower.includes('creature')) {
      creatures += 1
      return
    }
    if (typeLower.includes('spell')) {
      spells += 1
      return
    }
    if (typeLower.includes('solbind') || rarityLower.includes('solbind')) {
      solbind += 1
    }
  })

  return { creatures, spells, solbind }
}

const formatExpiry = (value?: string | number | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id || ''
  const origin = new URL(request.url).origin

  let forgebornImageUrl: string | null = null
  let deckName = `Deck ${deckId}`
  let factionLabel: string | null = null
  let setLabel: string | null = null
  let formatLabel = 'Normal'
  let metaLine = ''
  let cardCounts = { creatures: 0, spells: 0, solbind: 0 }

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

      deckName = deck?.name || deckName
      factionLabel = deck?.faction ? String(deck.faction).toUpperCase() : null
      setLabel = formatSetLabel(deck?.cardSetNo, deck?.cardSetId)
      formatLabel =
        String(deck?.format || '').toLowerCase().includes('fused') || deck?.is_fused ? 'Fused' : 'Normal'

      cardCounts = countCardTypes(deck)

      const owner = deck?.playerName || deck?.username || deck?.owner || null
      const score = deck?.deckScore ?? deck?.elo ?? deck?.deckRank ?? null
      const expiry = formatExpiry(
        deck?.expireAt ?? deck?.expire ?? deck?.expire_date ?? deck?.expireDate ?? deck?.pExpiry ?? null
      )
      const metaParts = [
        owner ? `Owner: ${owner}` : null,
        score !== null && score !== undefined && score !== '' ? `Score: ${score}` : null,
        expiry ? `Exp: ${expiry}` : null,
      ].filter(Boolean)
      metaLine = metaParts.join(' • ')
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

  const getImageInfo = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer)
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const view = new DataView(buffer)
      return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' }
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
          return { width, height, mime: 'image/jpeg' }
        }
        if (length <= 0) break
        offset += 2 + length
      }
    }
    return null
  }

  const imageInfo = imageData ? getImageInfo(imageData) : null
  const shouldRotate = !!imageInfo && imageInfo.height > imageInfo.width
  const imageSrc = imageData
    ? `data:${imageInfo?.mime || 'image/jpeg'};base64,${toBase64(imageData)}`
    : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          padding: '36px 40px',
          backgroundColor: '#0b1222',
          backgroundImage:
            'radial-gradient(900px circle at 10% 10%, rgba(56, 189, 248, 0.12), transparent 45%), radial-gradient(700px circle at 90% 0%, rgba(168, 85, 247, 0.10), transparent 45%), linear-gradient(135deg, #0b1222, #0f172a 45%, #111827)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              color: '#e2e8f0',
              fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
              lineHeight: 1.1,
              maxWidth: '780px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {deckName}
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {factionLabel && (
              <div style={{ padding: '6px 12px', borderRadius: '999px', backgroundColor: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(148, 163, 184, 0.35)', color: '#93c5fd', fontSize: 16, fontWeight: 600 }}>
                {factionLabel}
              </div>
            )}
            {setLabel && (
              <div style={{ padding: '6px 12px', borderRadius: '999px', backgroundColor: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(148, 163, 184, 0.35)', color: '#fcd34d', fontSize: 16, fontWeight: 600 }}>
                {setLabel}
              </div>
            )}
            <div style={{ padding: '6px 12px', borderRadius: '999px', backgroundColor: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(148, 163, 184, 0.35)', color: '#6ee7b7', fontSize: 16, fontWeight: 600 }}>
              {formatLabel}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '999px', backgroundColor: 'rgba(30, 64, 175, 0.35)', border: '1px solid rgba(96, 165, 250, 0.5)', color: '#bfdbfe', fontSize: 15, fontWeight: 600 }}>
            Creatures {cardCounts.creatures}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '999px', backgroundColor: 'rgba(99, 102, 241, 0.35)', border: '1px solid rgba(129, 140, 248, 0.5)', color: '#c7d2fe', fontSize: 15, fontWeight: 600 }}>
            Spells {cardCounts.spells}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '999px', backgroundColor: 'rgba(234, 179, 8, 0.25)', border: '1px solid rgba(250, 204, 21, 0.5)', color: '#fde68a', fontSize: 15, fontWeight: 600 }}>
            Solbind {cardCounts.solbind}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            borderRadius: '22px',
            border: '1px solid rgba(148, 163, 184, 0.45)',
            backgroundColor: 'rgba(15, 23, 42, 0.72)',
            boxShadow: '0 18px 40px rgba(15, 23, 42, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '18px',
              border: '1px solid rgba(226, 232, 240, 0.35)',
              backgroundColor: 'rgba(15, 23, 42, 0.45)',
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
                  transform: `${shouldRotate ? 'rotate(-90deg)' : ''} scale(1.45)`.trim(),
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
        {metaLine ? (
          <div
            style={{
              fontSize: 18,
              color: '#94a3b8',
              fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
            }}
          >
            {metaLine}
          </div>
        ) : null}
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
