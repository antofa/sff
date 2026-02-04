import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import type { ReactNode } from 'react'

export const runtime = 'edge'

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

const formatCardIdName = (cardId: string): string => {
  if (!cardId) return 'Unknown Card'
  if (/^[a-z0-9]{20,}$/i.test(cardId)) {
    return cardId
  }
  let name = cardId.replace(/^s\d+[a-z]*\d*[-_]?/i, '')
  if (!name || name.length < 2) {
    return cardId
  }
  name = name.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
  return toTitleCase(name) || cardId
}

const getCardDisplayName = (card: any): string => {
  if (typeof card === 'string') return formatCardIdName(card)
  const name = card?.name || card?.Name || card?.cardName || card?.title || null
  if (name) return String(name)
  const fallbackId = card?.id || card?.cardId || card?.card_id
  return fallbackId ? formatCardIdName(String(fallbackId)) : 'Unknown Card'
}

const buildCardSections = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId
  const creatures: string[] = []
  const spells: string[] = []
  const solbind: string[] = []
  const other: string[] = []

  cards.forEach((card: any) => {
    if (isForgebornCard(card, forgebornId)) return
    const name = getCardDisplayName(card)
    const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
    const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()
    if (typeLower.includes('creature')) {
      creatures.push(name)
      return
    }
    if (typeLower.includes('spell')) {
      spells.push(name)
      return
    }
    if (typeLower.includes('solbind') || rarityLower.includes('solbind')) {
      solbind.push(name)
      return
    }
    other.push(name)
  })

  const sections: Array<{ label: string; items: string[] }> = []
  const hasTyped = creatures.length > 0 || spells.length > 0 || solbind.length > 0
  if (hasTyped) {
    if (creatures.length > 0) sections.push({ label: `Creatures (${creatures.length})`, items: creatures })
    if (spells.length > 0) sections.push({ label: `Spells (${spells.length})`, items: spells })
    if (solbind.length > 0) sections.push({ label: `Solbind (${solbind.length})`, items: solbind })
  } else if (other.length > 0) {
    sections.push({ label: `Cards (${other.length})`, items: other })
  }
  return sections
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
type AbilityEntry = { title: string | null; text: string | null; level?: number | null }

const renderAbilityText = (
  text: string,
  statIconMap: Map<string, string | null>,
  levelIconMap: Map<number, string | null>
) => {
  const parts: Array<string | ReactNode> = []
  const pattern = /(\[l([1-4])\])|([+-]?\d+)([ADH])/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  let keyIndex = 0

  while ((match = pattern.exec(text)) !== null) {
    const [full, levelToken, levelNumber, number, stat] = match
    const start = match.index
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start))
    }
    if (levelToken) {
      const level = Number(levelNumber)
      const iconSrc = Number.isFinite(level) ? levelIconMap.get(level) || null : null
      if (!iconSrc) {
        parts.push(full)
      } else {
        parts.push(
          <img
            key={`level-${keyIndex++}`}
            src={iconSrc}
            style={{
              width: '16px',
              height: '16px',
              objectFit: 'contain',
              verticalAlign: 'middle',
            }}
          />
        )
      }
    } else {
      const iconSrc = statIconMap.get(stat) || null
      if (!iconSrc) {
        parts.push(full)
      } else {
        parts.push(
          <span key={`stat-${keyIndex++}`}>
            {number}
            <img
              src={iconSrc}
              style={{
                width: '16px',
                height: '16px',
                objectFit: 'contain',
                marginLeft: '4px',
                verticalAlign: 'middle',
              }}
            />
          </span>
        )
      }
    }
    lastIndex = start + full.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

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

const formatAbilityEntry = (ability: any): AbilityEntry | null => {
  if (!ability) return null
  if (typeof ability === 'string') {
    const text = stripMarkup(ability)
    return text ? { title: null, text, level: null } : null
  }
  if (typeof ability !== 'object') return null
  const levelRaw = Number(
    ability?.level ??
      ability?.lvl ??
      ability?.levelNumber ??
      ability?.rank ??
      ability?.abilityLevel ??
      NaN
  )
  const level = Number.isFinite(levelRaw) ? levelRaw : null
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
  return { title: title ? String(title).trim() : null, text, level }
}

const collectForgebornAbilities = (deck: any) => {
  const forgeborn = deck?.forgeborn
  const entries: AbilityEntry[] = []
  const pushAbility = (ability: any, levelOverride?: number | null) => {
    const entry = formatAbilityEntry(ability)
    if (entry) {
      entries.push({
        ...entry,
        level: levelOverride ?? entry.level ?? null,
      })
    }
  }

  if (!forgeborn || typeof forgeborn !== 'object') return entries

  const levelMap = forgeborn?.levels
  if (levelMap && typeof levelMap === 'object') {
    ;[2, 3, 4].forEach((level) => {
      const levelEntry = (levelMap as any)?.[level] ?? (levelMap as any)?.[String(level)]
      if (!levelEntry) return
      const text = levelEntry?.text ?? levelEntry?.Text ?? levelEntry?.description ?? levelEntry?.desc ?? null
      if (!text) return
      const name = levelEntry?.name || levelEntry?.Name || levelEntry?.title || null
      pushAbility(
        {
          name: name ? String(name) : null,
          text,
        },
        level
      )
    })
  }

  if (entries.length === 0) {
    const a2t = forgeborn?.a2t ?? forgeborn?.a2T ?? null
    const a3t = forgeborn?.a3t ?? forgeborn?.a3T ?? null
    const a4t = forgeborn?.a4t ?? forgeborn?.a4T ?? null
    const a2n = forgeborn?.a2n ?? forgeborn?.a2N ?? null
    const a3n = forgeborn?.a3n ?? forgeborn?.a3N ?? null
    const a4n = forgeborn?.a4n ?? forgeborn?.a4N ?? null
    if (a2t) pushAbility({ name: a2n ?? null, text: a2t }, 2)
    if (a3t) pushAbility({ name: a3n ?? null, text: a3t }, 3)
    if (a4t) pushAbility({ name: a4n ?? null, text: a4t }, 4)
  }

  if (entries.length === 0) {
    const rawAbilities =
      forgeborn?.abilities ||
      forgeborn?.abilityCards ||
      forgeborn?.ability_cards ||
      forgeborn?.abilityList ||
      forgeborn?.abilitiesList ||
      null
    if (Array.isArray(rawAbilities)) {
      rawAbilities.forEach((ability, index) => pushAbility(ability, 2 + index))
    } else if (rawAbilities) {
      pushAbility(rawAbilities)
    }

    const abilityKeys: Array<[string, number | null]> = [
      ['ability1', 2],
      ['ability2', 3],
      ['ability3', 4],
      ['ability4', null],
      ['ability5', null],
    ]
    abilityKeys.forEach(([key, level]) => {
      if (forgeborn?.[key]) pushAbility(forgeborn[key], level)
    })

    if (entries.length === 0) {
      const levelKeys: Array<[string, number]> = [
        ['1text', 2],
        ['2text', 3],
        ['3text', 4],
      ]
      levelKeys.forEach(([key, level]) => {
        if (forgeborn?.[key]) pushAbility(forgeborn[key], level)
      })
    }

    if (entries.length === 0 && (forgeborn?.text || forgeborn?.Text)) {
      pushAbility(forgeborn?.text || forgeborn?.Text)
    }
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

  let cardSections: Array<{ label: string; items: string[] }> = []
  let forgebornName: string | null = null
  let forgebornAbilities: AbilityEntry[] = []

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
      forgebornName = resolveForgebornName(deck)
      forgebornAbilities = collectForgebornAbilities(deck).slice(0, 3)
      cardSections = buildCardSections(deck)
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

  const abilityLevels = new Set<number>()
  const levelTokenPattern = /\[l([1-4])\]/gi
  forgebornAbilities.forEach((ability) => {
    const level = ability.level
    if (level && level >= 1 && level <= 4) {
      abilityLevels.add(level)
    }
    if (ability.text) {
      let match: RegExpExecArray | null
      while ((match = levelTokenPattern.exec(ability.text)) !== null) {
        const tokenLevel = Number(match[1])
        if (Number.isFinite(tokenLevel)) {
          abilityLevels.add(tokenLevel)
        }
      }
    }
  })
  const levelIconEntries = Array.from(abilityLevels)
    .sort((a, b) => a - b)
    .map((level) => ({ level, url: `${origin}/images/icons/levels/lv${level}-icon.png` }))
  const levelIconMap = new Map<number, string | null>()
  if (levelIconEntries.length > 0) {
    const loaded = await Promise.all(levelIconEntries.map((entry) => loadIcon(entry.url)))
    loaded.forEach((item, idx) => {
      const entry = levelIconEntries[idx]
      const src = item.data ? `data:image/png;base64,${toBase64(item.data)}` : item.url
      levelIconMap.set(entry.level, src || null)
    })
  }

  const statIconEntries = [
    { key: 'A', url: `${origin}/images/icons/attack.png` },
    { key: 'H', url: `${origin}/images/icons/health.png` },
    { key: 'D', url: `${origin}/images/icons/armor.png` },
  ]
  const statIconMap = new Map<string, string | null>()
  if (statIconEntries.length > 0) {
    const loaded = await Promise.all(statIconEntries.map((entry) => loadIcon(entry.url)))
    loaded.forEach((item, idx) => {
      const entry = statIconEntries[idx]
      const src = item.data ? `data:image/png;base64,${toBase64(item.data)}` : item.url
      statIconMap.set(entry.key, src || null)
    })
  }

  const hasCardSections = cardSections.length > 0

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
            gap: '14px',
            color: '#e2e8f0',
            fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          }}
        >
          {hasCardSections ? (
            cardSections.map((section) => (
              <div key={section.label} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span
                  style={{
                    color: '#94a3b8',
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {section.label}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: 18, lineHeight: 1.25 }}>
                  {section.items.map((name, idx) => (
                    <span key={`${section.label}-${idx}`}>• {name}</span>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: '#94a3b8', fontSize: 18 }}>No cards available</div>
          )}
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
                forgebornAbilities.map((ability, idx) => {
                  const levelIconSrc =
                    ability.level && levelIconMap.has(ability.level) ? levelIconMap.get(ability.level) : null
                  return (
                    <div key={`ability-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {levelIconSrc ? (
                        <img
                          src={levelIconSrc}
                          style={{ width: '18px', height: '18px', objectFit: 'contain' }}
                        />
                      ) : null}
                      {ability.text ? (
                        <span>{renderAbilityText(ability.text, statIconMap, levelIconMap)}</span>
                      ) : null}
                    </div>
                  )
                })
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
