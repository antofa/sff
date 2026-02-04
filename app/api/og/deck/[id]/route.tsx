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

const getCardListEntry = (deck: any, card: any) => {
  const cardData = typeof card === 'object' && card ? card : null
  const cardId = cardData?.id || cardData?.cardId || cardData?.card_id || undefined
  const isBetrayer = cardData?.betrayer === true || cardData?.betrayer === 'true'
  const factionForIcon =
    (isBetrayer && cardData?.crossFaction ? cardData.crossFaction : cardData?.faction) || deck?.faction
  const factionLower = String(factionForIcon || '').toLowerCase().trim()
  const rarity = cardData?.rarity || null
  const isForgeborn =
    String(cardData?.type || cardData?.cardType || '')
      .toLowerCase()
      .includes('forgeborn') || String(cardData?.rarity || '').toLowerCase().includes('forgeborn')

  return {
    name: getCardDisplayName(card),
    factionIconPath: factionLower ? `/images/icons/${factionLower}.png` : null,
    rarityIconPath: !isForgeborn
      ? getRarityIconPath(deck?.cardSetNo, rarity, cardId ? String(cardId) : undefined, cardData)
      : null,
    factionColor: getFactionBadgeColor(
      typeof factionForIcon === 'string' ? factionForIcon : typeof deck?.faction === 'string' ? deck.faction : undefined
    ),
  }
}

const buildCardSections = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId
  const creatures: CardListEntry[] = []
  const spells: CardListEntry[] = []
  const solbind: CardListEntry[] = []
  const other: CardListEntry[] = []

  cards.forEach((card: any) => {
    if (isForgebornCard(card, forgebornId)) return
    const entry = getCardListEntry(deck, card)
    const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
    const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()
    if (typeLower.includes('creature')) {
      creatures.push(entry)
      return
    }
    if (typeLower.includes('spell')) {
      spells.push(entry)
      return
    }
    if (typeLower.includes('solbind') || rarityLower.includes('solbind')) {
      solbind.push(entry)
      return
    }
    other.push(entry)
  })

  const sections: CardSection[] = []
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const abortLater = setTimeout(() => {
    try {
      controller.abort()
    } catch {
      // ignore
    }
  }, timeoutMs)
  try {
    const response = await withTimeout(
      fetch(url, { ...init, signal: controller.signal }).catch(() => null),
      timeoutMs,
      null
    )
    return response
  } catch {
    return null
  } finally {
    clearTimeout(abortLater)
  }
}

const stripMarkup = (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
const normalizeForgebornAbilityText = (value: string) => value.replace(/([^\s])([+-])(?=\d)/g, '$1 $2')
type AbilityEntry = { title: string | null; text: string | null; level?: number | null }
type CardListEntry = {
  name: string
  factionIconPath: string | null
  rarityIconPath: string | null
  factionColor: string
}
type CardSection = { label: string; items: CardListEntry[] }

const getFactionBadgeColor = (faction?: string): string => {
  switch (faction) {
    case 'Alloyin':
      return '#06b6d4'
    case 'Uterra':
      return '#14b8a6'
    case 'Tempys':
      return '#f97316'
    case 'Nekrium':
      return '#a855f7'
    default:
      return '#6b7280'
  }
}

const normalizeRarityLabel = (rarity?: string | null): string | null => {
  if (!rarity) return null
  let normalized = rarity.trim()
  const lower = normalized.toLowerCase()
  if (lower === 'common common' || lower.match(/^common\s+common$/)) {
    normalized = 'CommonCommon'
  } else if (lower === 'rare rare' || lower.match(/^rare\s+rare$/)) {
    normalized = 'RareRare'
  } else if (lower.includes('darkforge') && lower.includes('rare')) {
    normalized = 'DarkforgeRare'
  } else if (lower.match(/^rare\s+common$/i) || (lower.startsWith('rare') && lower.includes('common') && !lower.startsWith('common'))) {
    normalized = 'RareCommon'
  } else if (lower.match(/^common\s+rare$/i) || (lower.startsWith('common') && lower.includes('rare'))) {
    normalized = 'CommonRare'
  } else if (lower.includes('common') && lower.includes('rare')) {
    normalized = 'CommonRare'
  } else if (lower.includes('common') && !lower.includes('rare')) {
    normalized = 'Common'
  } else if (lower.includes('rare') && !lower.includes('common')) {
    normalized = 'Rare'
  } else if (lower.includes('darkforge')) {
    normalized = 'Darkforge'
  } else if (lower.includes('ls') || lower.includes('legendary')) {
    normalized = 'LS'
  } else if (lower.includes('solbind')) {
    normalized = 'Solbind'
  }
  return normalized
}

const getRarityIconPath = (
  cardSetNo?: string | number,
  rarity?: string,
  cardId?: string,
  cardData?: any
): string | null => {
  const normalizedRarity = normalizeRarityLabel(rarity)
  if (!normalizedRarity) return null

  let cardSet: string | undefined
  if (cardData) {
    cardSet = cardData.cardSetId || cardData.CardSetId || cardData.SK || cardData.sk
    if (cardSet) {
      cardSet = String(cardSet).toLowerCase().trim()
    }
  }
  if (!cardSet && cardSetNo) {
    cardSet = String(cardSetNo).toLowerCase().trim()
  }
  if (!cardSet && cardId) {
    if (/^b3_/i.test(cardId)) {
      cardSet = 'b3'
    } else if (/^b2_/i.test(cardId)) {
      cardSet = 'b2'
    } else if (/^b1_/i.test(cardId)) {
      cardSet = 'b1'
    } else {
      const match = cardId.match(/^s(\d+)/i)
      if (match && match[1]) {
        cardSet = `s${match[1]}`
      }
    }
  }

  const isB3Set =
    (cardSet && (cardSet.toUpperCase() === 'B3' || cardSet === 'b3')) ||
    (cardId && /^b3_/i.test(cardId))
  const isB2Set =
    (cardSet && (cardSet.toUpperCase() === 'B2' || cardSet === 'b2')) ||
    (cardId && /^b2_/i.test(cardId))
  const isB1Set =
    (cardSet && (cardSet.toUpperCase() === 'B1' || cardSet === 'b1')) ||
    (cardId && /^b1_/i.test(cardId))

  if (isB3Set) return `/images/icons/rarity/B3_${normalizedRarity}.png`
  if (isB2Set) return `/images/icons/rarity/B2_${normalizedRarity}.png`
  if (isB1Set) return `/images/icons/rarity/B1_${normalizedRarity}.png`

  let setNo = '1'
  if (cardSet) {
    const match = cardSet.match(/^s?(\d+)/i)
    if (match && match[1]) {
      setNo = match[1]
    } else {
      setNo = cardSet
    }
  }
  if (setNo === '99') setNo = '1'
  return `/images/icons/rarity/S${setNo}_${normalizedRarity}.png`
}

const renderAbilityText = (
  text: string,
  statIconMap: Map<string, string | null>,
  levelIconMap: Map<number, string | null>
) => {
  const normalizedText = normalizeForgebornAbilityText(text)
  const parts: Array<string | ReactNode> = []
  const pattern = /(\[l([1-4])\])|([+-]?\d+)([ADH])/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  let keyIndex = 0

  while ((match = pattern.exec(normalizedText)) !== null) {
    const [full, levelToken, levelNumber, number, stat] = match
    const start = match.index
    if (start > lastIndex) {
      parts.push(normalizedText.slice(lastIndex, start))
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
              transform: 'translateY(1px)',
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
                width: '27px',
                height: '27px',
                objectFit: 'contain',
                marginLeft: '6px',
                verticalAlign: 'middle',
                transform: 'translateY(3px)',
              }}
            />
          </span>
        )
      }
    }
    lastIndex = start + full.length
  }

  if (lastIndex < normalizedText.length) {
    parts.push(normalizedText.slice(lastIndex))
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
    const text = normalizeForgebornAbilityText(stripMarkup(ability))
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
  const text = rawText ? normalizeForgebornAbilityText(stripMarkup(String(rawText))) : null
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

  let cardSections: CardSection[] = []
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
      const json = await withTimeout(res.json().catch(() => null), OG_DECK_TIMEOUT_MS, null)
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

  const resolveAssetUrl = (url: string | null) => {
    if (!url) return null
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
    return `${origin}${url.startsWith('/') ? '' : '/'}${url}`
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
        const data = await withTimeout(iconRes.arrayBuffer().catch(() => null), OG_ICON_TIMEOUT_MS, null)
        return { url, data }
      }
    } catch {
      // ignore
    }
    return { url, data: null }
  }

  const cardIconPaths = Array.from(
    new Set(
      cardSections.flatMap((section) =>
        section.items.flatMap((item) => [item.factionIconPath, item.rarityIconPath]).filter(Boolean)
      )
    )
  ) as string[]
  const cardIconMap = new Map<string, string | null>()
  if (cardIconPaths.length > 0) {
    const loaded = await Promise.all(cardIconPaths.map((path) => loadIcon(resolveAssetUrl(path))))
    loaded.forEach((item, idx) => {
      const path = cardIconPaths[idx]
      const src = item.data ? `data:image/png;base64,${toBase64(item.data)}` : item.url || resolveAssetUrl(path)
      cardIconMap.set(path, src || null)
    })
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
          alignItems: 'stretch',
          gap: '24px',
          padding: '24px 28px',
          backgroundColor: '#0f172a',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 27, lineHeight: 1.2 }}>
                  {section.items.map((item, idx) => {
                    const factionIconSrc = item.factionIconPath
                      ? cardIconMap.get(item.factionIconPath) || resolveAssetUrl(item.factionIconPath)
                      : null
                    const rarityIconSrc = item.rarityIconPath
                      ? cardIconMap.get(item.rarityIconPath) || resolveAssetUrl(item.rarityIconPath)
                      : null
                    return (
                      <div
                        key={`${section.label}-${idx}`}
                        style={{ display: 'flex', alignItems: 'center', gap: '9px', minHeight: '30px' }}
                      >
                        {factionIconSrc ? (
                          <img src={factionIconSrc} style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                        ) : (
                          <span
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '999px',
                              backgroundColor: item.factionColor,
                              opacity: 0.8,
                            }}
                          />
                        )}
                        {rarityIconSrc ? (
                          <img src={rarityIconSrc} style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                        ) : (
                          <span
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '999px',
                              backgroundColor: item.factionColor,
                              opacity: 0.8,
                            }}
                          />
                        )}
                        <span>{item.name}</span>
                      </div>
                    )
                  })}
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
            minWidth: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'flex-start',
            paddingLeft: '0',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: 22, lineHeight: 1.3, width: '100%' }}>
              {forgebornAbilities.length > 0 ? (
                forgebornAbilities.map((ability, idx) => {
                  const levelIconSrc =
                    ability.level && levelIconMap.has(ability.level) ? levelIconMap.get(ability.level) : null
                  return (
                    <div key={`ability-${idx}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%' }}>
                      {levelIconSrc ? (
                        <img
                          src={levelIconSrc}
                          style={{
                            width: '18px',
                            height: '18px',
                            objectFit: 'contain',
                            transform: 'translateY(1px)',
                          }}
                        />
                      ) : null}
                      {ability.text ? (
                        <span
                          style={{
                            display: 'block',
                            flex: 1,
                            minWidth: 0,
                            whiteSpace: 'normal',
                            lineHeight: 1.35,
                          }}
                        >
                          {renderAbilityText(ability.text, statIconMap, levelIconMap)}
                        </span>
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
