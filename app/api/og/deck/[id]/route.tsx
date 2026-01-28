import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { getCardImageUrl, getForgebornAlternativeUrl } from '@/lib/api'
import { computeCreatureTypesForDeck } from '@/lib/creatureTypes'

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
  if (/^s\d+/.test(lower)) return lower.toUpperCase()
  if (/^\d+$/.test(lower)) return `S${lower}`
  return text.toUpperCase()
}

const toTitleCase = (value: string) =>
  value
    .split(' ')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')

const isForgebornCard = (card: any, forgebornId?: string | null) => {
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

const countCardTypes = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId

  let creatures = 0
  let spells = 0
  let solbind = 0

  cards.forEach((card: any) => {
    if (isForgebornCard(card, forgebornId)) return
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

const formatRarityLabel = (value: unknown) => {
  if (!value && value !== 0) return null
  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').toLowerCase()
  return toTitleCase(normalized)
}

const countRarities = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId
  const counts: Record<string, number> = {}

  cards.forEach((card: any) => {
    if (isForgebornCard(card, forgebornId)) return
    if (!card || typeof card !== 'object') return
    const rarityValue = card?.rarity || card?.cardRarity || card?.rarityType
    const label = formatRarityLabel(rarityValue)
    if (!label) return
    counts[label] = (counts[label] || 0) + 1
  })

  return Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => {
      const diff = Number(b[1]) - Number(a[1])
      if (diff !== 0) return diff
      return a[0].localeCompare(b[0])
    })
}

const getCreatureTags = (deck: any) => {
  try {
    const creatureMap = computeCreatureTypesForDeck(deck)
    if (!creatureMap || typeof creatureMap !== 'object') return []
    return Object.entries(creatureMap)
      .filter(([, count]) => Number(count) > 0)
      .sort((a, b) => {
        const diff = Number(b[1]) - Number(a[1])
        if (diff !== 0) return diff
        return a[0].localeCompare(b[0])
      })
  } catch {
    return []
  }
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

const formatScore = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return null
  return Math.round(numeric * 100)
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id || ''
  const origin = new URL(request.url).origin

  let forgebornImageUrl: string | null = null
  let cardCounts = { creatures: 0, spells: 0, solbind: 0 }
  let rarityEntries: Array<[string, number]> = []
  let creatureTags: Array<[string, number]> = []
  let owner: string | null = null
  let score: number | null = null
  let elo: number | null = null
  let expiry: string | null = null
  let setLabel: string | null = null

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

      cardCounts = countCardTypes(deck)
      rarityEntries = countRarities(deck)
      creatureTags = getCreatureTags(deck)
      setLabel = formatSetLabel(deck?.cardSetNo, deck?.cardSetId)

      owner = deck?.playerName || deck?.username || deck?.owner || null
      score = formatScore(deck?.deckScore ?? deck?.elo ?? deck?.deckRank ?? null)
      elo = formatScore(deck?.elo ?? null)
      expiry = formatExpiry(
        deck?.expireAt ?? deck?.expire ?? deck?.expire_date ?? deck?.expireDate ?? deck?.pExpiry ?? null
      )
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

  const ownerLabel = owner || '-'
  const scoreLabel = score === null ? '-' : String(score)
  const eloLabel = elo === null ? '-' : String(elo)
  const expiryLabel = expiry || '-'
  const setValue = setLabel || '-'
  const rarityText =
    rarityEntries.length > 0
      ? rarityEntries.map(([label, count]) => `${label} ${count}`).join(' • ')
      : '-'
  const tagText =
    creatureTags.length > 0
      ? creatureTags.map(([label, count]) => `${toTitleCase(label)} ${count}`).join(' • ')
      : '-'

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          padding: '24px 28px',
          backgroundColor: '#0f172a',
        }}
      >
        <div
          style={{
            width: '300px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            color: '#e2e8f0',
            fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: 24 }}>
            <span style={{ color: '#94a3b8' }}>Set</span>
            <span style={{ fontWeight: 600 }}>{setValue}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: 24 }}>
            <span style={{ color: '#94a3b8' }}>Creatures</span>
            <span style={{ fontWeight: 600 }}>{cardCounts.creatures}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: 24 }}>
            <span style={{ color: '#94a3b8' }}>Spells</span>
            <span style={{ fontWeight: 600 }}>{cardCounts.spells}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: 24 }}>
            <span style={{ color: '#94a3b8' }}>Solbind</span>
            <span style={{ fontWeight: 600 }}>{cardCounts.solbind}</span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: 20,
              lineHeight: 1.3,
            }}
          >
            <span style={{ color: '#94a3b8' }}>Rarities</span>
            <span style={{ color: '#e2e8f0' }}>{rarityText}</span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: 20,
              lineHeight: 1.3,
            }}
          >
            <span style={{ color: '#94a3b8' }}>Creature Tags</span>
            <span style={{ color: '#e2e8f0' }}>{tagText}</span>
          </div>
          <div style={{ height: '1px', backgroundColor: 'rgba(148, 163, 184, 0.25)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 23 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Owner</span>
              <span style={{ fontWeight: 600 }}>{ownerLabel}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Score</span>
              <span style={{ fontWeight: 600 }}>{scoreLabel}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ color: '#94a3b8' }}>ELO</span>
              <span style={{ fontWeight: 600 }}>{eloLabel}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Expiry</span>
              <span style={{ fontWeight: 600 }}>{expiryLabel}</span>
            </div>
          </div>
        </div>
        <div
          style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingLeft: '12px',
          }}
        >
          <div
            style={{
              width: '860px',
              height: '560px',
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
                  transform: `${shouldRotate ? 'rotate(-90deg)' : ''} scale(1.5)`.trim(),
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
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
