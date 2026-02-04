import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { computeCreatureTypesForDeck } from '@/lib/creatureTypes'

export const runtime = 'edge'

const formatSetLabel = (value?: string | number | null, fallback?: string | number | null) => {
  const raw = value ?? fallback
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'b1') return 'B1'
  if (lower === 'b2') return 'B2'
  if (lower === 'b3') return 'B3'
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

const formatElo = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return null
  return Math.round(numeric)
}

const OG_DECK_TIMEOUT_MS = 1200
const OG_ICON_TIMEOUT_MS = 500

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

const stripMarkup = (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

const resolveForgebornName = (deck: any) => {
  const forgeborn = deck?.forgeborn
  const named =
    forgeborn?.name ||
    forgeborn?.Name ||
    forgeborn?.title ||
    forgeborn?.cardName ||
    null
  if (named) return String(named).trim()
  const fallback = deck?.forgebornName || deck?.forgebornId || forgeborn?.id || null
  if (!fallback) return null
  return toTitleCase(String(fallback).replace(/[_-]+/g, ' ').trim())
}

const formatAbilityEntry = (ability: any) => {
  if (!ability) return null
  if (typeof ability === 'string') {
    const text = stripMarkup(ability)
    return text ? { title: null, text } : null
  }
  if (typeof ability !== 'object') return null
  const title = ability?.name || ability?.Name || ability?.title || ability?.cardName || null
  const rawText =
    ability?.text ||
    ability?.Text ||
    ability?.description ||
    ability?.desc ||
    ability?.['1text'] ||
    ability?.['2text'] ||
    ability?.['3text'] ||
    null
  const text = rawText ? stripMarkup(String(rawText)) : null
  if (!title && !text) return null
  return { title: title ? String(title).trim() : null, text }
}

const collectForgebornAbilities = (deck: any) => {
  const forgeborn = deck?.forgeborn
  const entries: Array<{ title: string | null; text: string | null }> = []
  const pushAbility = (ability: any) => {
    const entry = formatAbilityEntry(ability)
    if (entry) entries.push(entry)
  }

  if (!forgeborn || typeof forgeborn !== 'object') return entries

  const rawAbilities =
    forgeborn?.abilities ||
    forgeborn?.abilityCards ||
    forgeborn?.ability_cards ||
    forgeborn?.abilityList ||
    forgeborn?.abilitiesList ||
    null
  if (Array.isArray(rawAbilities)) {
    rawAbilities.forEach(pushAbility)
  } else if (rawAbilities) {
    pushAbility(rawAbilities)
  }

  const abilityKeys = ['ability1', 'ability2', 'ability3', 'ability4', 'ability5']
  abilityKeys.forEach((key) => {
    if (forgeborn?.[key]) pushAbility(forgeborn[key])
  })

  if (entries.length === 0) {
    const levelKeys = ['1text', '2text', '3text']
    levelKeys.forEach((key) => {
      if (forgeborn?.[key]) pushAbility(forgeborn[key])
    })
  }

  if (entries.length === 0 && (forgeborn?.text || forgeborn?.Text)) {
    pushAbility(forgeborn?.text || forgeborn?.Text)
  }

  return entries
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id || ''
  const origin = new URL(request.url).origin

  let factionIconUrl: string | null = null
  let fusedSetEntries: Array<{ label: string; iconUrl: string | null }> = []
  let cardCounts = { creatures: 0, spells: 0, solbind: 0 }
  let rarityEntries: Array<[string, number]> = []
  let creatureTags: Array<[string, number]> = []
  let owner: string | null = null
  let score: number | null = null
  let elo: number | null = null
  let expiry: string | null = null
  let setLabel: string | null = null
  let forgebornName: string | null = null
  let forgebornAbilities: Array<{ title: string | null; text: string | null }> = []

  const resolveFactionIconUrl = (factionRaw?: string | null) => {
    const factionKey = factionRaw ? String(factionRaw).trim().toLowerCase() : ''
    if (factionKey === 'alloyin') return `${origin}/images/icons/alloyin.png`
    if (factionKey === 'nekrium') return `${origin}/images/icons/nekrium.png`
    if (factionKey === 'tempys') return `${origin}/images/icons/tempys.png`
    if (factionKey === 'uterra') return `${origin}/images/icons/uterra.png`
    return null
  }

  try {
    const deckUrl = `${origin}/api/deck/${encodeURIComponent(deckId)}?fast=1&skipOwnerMerge=1`
    const res = await fetchWithTimeout(
      deckUrl,
      {
        headers: { Accept: 'application/json' },
        cache: 'force-cache',
        next: { revalidate: 300 },
      },
      OG_DECK_TIMEOUT_MS
    )
    if (res?.ok) {
      const json = await res.json()
      const deck = json?.deck
      const isFused = String(deck?.format || '').toLowerCase() === 'fused'
      forgebornName = resolveForgebornName(deck)
      forgebornAbilities = collectForgebornAbilities(deck).slice(0, 3)

      cardCounts = countCardTypes(deck)
      rarityEntries = countRarities(deck)
      creatureTags = getCreatureTags(deck)
      setLabel = formatSetLabel(deck?.cardSetNo, deck?.cardSetId)
      if (isFused) {
        const sources = Array.isArray(deck?.myDecks) ? deck.myDecks : []
        const mappedEntries: Array<{ label: string; iconUrl: string | null } | null> = sources.map(
          (src: any) => {
            const label = formatSetLabel(src?.cardSetNo, src?.cardSetId)
            if (!label) return null
            const factionRaw =
              src?.faction ||
              src?.factionName ||
              src?.deckFaction ||
              src?.forgeborn?.faction ||
              null
            return {
              label,
              iconUrl: resolveFactionIconUrl(factionRaw),
            }
          }
        )
        fusedSetEntries = mappedEntries
          .filter((entry): entry is { label: string; iconUrl: string | null } => !!entry)
          .slice(0, 2)
      } else {
        const factionRaw =
          deck?.faction ||
          deck?.factionName ||
          deck?.deckFaction ||
          deck?.forgeborn?.faction ||
          null
        factionIconUrl = resolveFactionIconUrl(factionRaw)
      }

      owner = deck?.playerName || deck?.username || deck?.owner || null
      score = formatScore(deck?.deckScore ?? deck?.elo ?? deck?.deckRank ?? null)
      elo = formatElo(deck?.elo ?? null)
      expiry = formatExpiry(
        deck?.expireAt ?? deck?.expire ?? deck?.expire_date ?? deck?.expireDate ?? deck?.pExpiry ?? null
      )
    }
  } catch {
    // ignore fetch failures
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

  const loadIcon = async (url: string | null) => {
    if (!url) return { url: null, data: null }
    try {
      const iconRes = await fetchWithTimeout(
        url,
        {
          cache: 'force-cache',
          next: { revalidate: 86400 },
        },
        OG_ICON_TIMEOUT_MS
      )
      if (iconRes?.ok) {
        return { url, data: await iconRes.arrayBuffer() }
      }
    } catch {
      // ignore
    }
    return { url, data: null }
  }

  let factionIconData: ArrayBuffer | null = null
  if (factionIconUrl) {
    const result = await loadIcon(factionIconUrl)
    factionIconData = result.data
  }

  let fusedSetIconMap = new Map<string, string | null>()
  if (fusedSetEntries.length > 0) {
    const uniqueUrls = Array.from(new Set(fusedSetEntries.map((entry) => entry.iconUrl).filter(Boolean)))
    const loaded = await Promise.all(uniqueUrls.map((url) => loadIcon(url as string)))
    loaded.forEach((item) => {
      const src = item.data ? `data:image/png;base64,${toBase64(item.data)}` : item.url
      if (item.url) fusedSetIconMap.set(item.url, src || null)
    })
  }

  const factionIconSrc = factionIconData
    ? `data:image/png;base64,${toBase64(factionIconData)}`
    : factionIconUrl

  const fusedSetDisplay = fusedSetEntries.map((entry) => ({
    label: entry.label,
    iconSrc: entry.iconUrl ? fusedSetIconMap.get(entry.iconUrl) || entry.iconUrl : null,
  }))

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
            {fusedSetDisplay.length > 0 ? (
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {fusedSetDisplay.map((entry, idx) => (
                  <div key={`${entry.label}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {entry.iconSrc ? (
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(15, 23, 42, 0.6)',
                          border: '1px solid rgba(148, 163, 184, 0.25)',
                        }}
                      >
                        <img src={entry.iconSrc} style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                      </div>
                    ) : null}
                    <span>{entry.label}</span>
                    {idx < fusedSetDisplay.length - 1 ? <span style={{ color: '#94a3b8' }}>,</span> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {factionIconSrc ? (
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(148, 163, 184, 0.25)',
                    }}
                  >
                    <img
                      src={factionIconSrc}
                      style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                    />
                  </div>
                ) : null}
                {setValue}
              </div>
            )}
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
            <span style={{ color: '#94a3b8' }}>Creature Types</span>
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
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
              gap: '18px',
              padding: '18px 24px',
              color: '#e2e8f0',
              fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
            }}
          >
            <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>
              {forgebornName || 'Forgeborn'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: 22, lineHeight: 1.3 }}>
              {forgebornAbilities.length > 0 ? (
                forgebornAbilities.map((ability, idx) => (
                  <div key={`ability-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {ability.title ? (
                      <span style={{ color: '#94a3b8', fontSize: 16, fontWeight: 700, letterSpacing: '0.04em' }}>
                        {ability.title}
                      </span>
                    ) : null}
                    {ability.text ? <span>{ability.text}</span> : null}
                  </div>
                ))
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 20 }}>Abilities unavailable</div>
              )}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400',
      },
    }
  )
}
