'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { Modal, Stack, Paper, Title, Text, Group, Badge, Button, Divider, Image, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMediaQuery } from '@mantine/hooks'
import { IconCalendar, IconCopy, IconExternalLink, IconWorld } from '@tabler/icons-react'
import NextImage from 'next/image'
import type { Deck } from '@/store/deckStore'
import { addComputedFields } from '@/store/deckStore'
import { formatCardName, getCardImageUrl, getCardImageUrls, getCardInfo, getForgebornAlternativeUrl, type CardInfo } from '@/lib/api'
import { logWithTimestamp } from '@/lib/logger'
import { pluralize } from '@/lib/pluralize'
import { computeCreatureTypesForDeck } from '@/lib/creatureTypes'
import { fetchCreatureTypesForDeckId } from '@/lib/creatureTypeOverrides'
import { useDeckStore } from '@/store/deckStore'

type CreatureTypeMap = Record<string, number>

const KNOWN_FORGEBORN_NAMES = ['cercee', 'ironbeard', 'xerxes', 'kitaru', 'nova']

const isFusedDeckLike = (deck: any) => String(deck?.format || '').toLowerCase() === 'fused'

const hasMeaningfulDeckValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

const normalizeDeckId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

const mergeDeckForDisplay = (deck: Deck | null, fullDeckData: Deck | null): Deck | null => {
  if (!deck && !fullDeckData) return null
  if (!fullDeckData) return deck
  if (!deck) return fullDeckData
  const deckId = normalizeDeckId((deck as any)?.id)
  const fullDeckId = normalizeDeckId((fullDeckData as any)?.id)
  if (deckId && fullDeckId && deckId !== fullDeckId) {
    return deck
  }

  const merged: Record<string, unknown> = {
    ...(deck as Record<string, unknown>),
    ...(fullDeckData as Record<string, unknown>),
  }

  const fillFromDeckIfMissing = (field: string) => {
    const currentValue = merged[field]
    const deckValue = (deck as Record<string, unknown>)[field]
    if (!hasMeaningfulDeckValue(currentValue) && hasMeaningfulDeckValue(deckValue)) {
      merged[field] = deckValue
    }
  }

  ;[
    'expireAt',
    'expire',
    'expireDate',
    'expire_date',
    'pExpiry',
    'playerName',
    'username',
    'owner',
    'tags',
    'deckScore',
    'elo',
    'faction',
    'forgebornId',
    'cardSetNo',
    'cardSetId',
  ].forEach(fillFromDeckIfMissing)

  if (!hasMeaningfulDeckValue(merged.cards)) {
    fillFromDeckIfMissing('cards')
  }

  if (!hasMeaningfulDeckValue(merged.myDecks)) {
    fillFromDeckIfMissing('myDecks')
  }

  if (!hasMeaningfulDeckValue(merged.fusedDeckIds)) {
    fillFromDeckIfMissing('fusedDeckIds')
  }

  return merged as Deck
}

const buildCreatureTypeEntries = (
  deckLike: any,
  options: { fallbackCards?: any[] } = {}
) => {
  if (!deckLike) return []
  let creatureMap: CreatureTypeMap | undefined =
    (deckLike.computed?.creatureType as CreatureTypeMap | undefined) ||
    ((deckLike as any).creatureType as CreatureTypeMap | undefined)

  if (!creatureMap) {
    try {
      creatureMap = computeCreatureTypesForDeck(deckLike)
    } catch (err) {
      console.warn('[DeckDetails] creatureType fallback failed', err)
    }
  }

  if ((!creatureMap || Object.keys(creatureMap).length === 0) && options.fallbackCards) {
    try {
      creatureMap = computeCreatureTypesForDeck({ cards: options.fallbackCards })
    } catch {
      // ignore
    }
  }

  if (!creatureMap || typeof creatureMap !== 'object') return []

  return Object.entries(creatureMap)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => {
      const diff = Number(b[1]) - Number(a[1])
      if (diff !== 0) return diff
      return a[0].localeCompare(b[0])
    })
}

const buildFusedCreatureTypeEntries = (
  deck: Deck,
  options: {
    deckCreatureTypesMap?: Record<string, CreatureTypeMap>
    deckCreatureTypeOverrides?: Record<string, CreatureTypeMap>
    allDecks?: Deck[]
  } = {}
) => {
  if (!isFusedDeckLike(deck)) return []
  const deckCreatureTypesMap = options.deckCreatureTypesMap || {}
  const deckCreatureTypeOverrides = options.deckCreatureTypeOverrides || {}
  const allDecks = options.allDecks || []
  const regularByName = new Map<string, Deck>()
  allDecks.forEach((d) => {
    if (!d?.name) return
    if (isFusedDeckLike(d)) return
    regularByName.set(d.name.trim().toLowerCase(), d)
  })
  const regularById = new Map<string, Deck>()
  allDecks.forEach((d) => {
    if (!d?.id) return
    if (isFusedDeckLike(d)) return
    regularById.set(String(d.id).trim().toLowerCase(), d)
  })

  const normalizeName = (value?: string | null) => (value ? value.trim().toLowerCase() : '')
  const normalizeId = (value?: string | null) => {
    if (!value) return ''
    return value
      .trim()
      .toLowerCase()
      .replace(/^deck[_-]?/i, '')
      .replace(/^fused[_-]?/i, '')
  }
  const resolveCreatureMap = (d?: Deck | null) => {
    if (!d) return undefined
    const override =
      (d.id && deckCreatureTypeOverrides[d.id]) ||
      (d.id && deckCreatureTypeOverrides[String(d.id).trim().toLowerCase()]) ||
      undefined
    if (override && Object.keys(override).length > 0) return override
    if (d.computed?.creatureType && Object.keys(d.computed.creatureType).length > 0) {
      return d.computed.creatureType as CreatureTypeMap
    }
    const mapFromStore = d.id ? deckCreatureTypesMap[d.id] : undefined
    if (mapFromStore && Object.keys(mapFromStore).length > 0) return mapFromStore
    return undefined
  }

  const sourceCandidates: Array<{ id?: string; name?: string }> = []
  const deckAny = deck as any
  if (Array.isArray(deckAny.myDecks)) {
    deckAny.myDecks.forEach((d: any) => {
      if (d?.id || d?.name || d?.deckId || d?.deckName) {
        sourceCandidates.push({ id: d.id || d.deckId, name: d.name || d.deckName })
      }
    })
  } else if (Array.isArray(deckAny.fusedDeckIds)) {
    deckAny.fusedDeckIds.forEach((id: string) => sourceCandidates.push({ id }))
  }

  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const combined: CreatureTypeMap = {}

  const addMap = (map?: CreatureTypeMap) => {
    if (!map) return
    Object.entries(map).forEach(([type, count]) => {
      if (typeof count !== 'number') return
      combined[type] = (combined[type] || 0) + count
    })
  }

  sourceCandidates.forEach(({ id, name }) => {
    if (id) {
      const normalizedId = normalizeId(String(id))
      if (normalizedId && !seenIds.has(normalizedId)) {
        seenIds.add(normalizedId)
        const byStore = deckCreatureTypesMap[id] || deckCreatureTypesMap[normalizedId]
        if (byStore) {
          addMap(byStore)
          return
        }
        const match = regularById.get(normalizedId)
        const resolved = resolveCreatureMap(match)
        if (resolved) {
          addMap(resolved)
          return
        }
      }
    }
    if (name) {
      const normalized = normalizeName(String(name))
      if (!normalized || seenNames.has(normalized)) return
      seenNames.add(normalized)
      const match = regularByName.get(normalized)
      if (match?.id) {
        const resolved = resolveCreatureMap(match)
        if (resolved) addMap(resolved)
      }
    }
  })

  if (Object.keys(combined).length === 0) return []

  return Object.entries(combined)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => {
      const diff = Number(b[1]) - Number(a[1])
      if (diff !== 0) return diff
      return a[0].localeCompare(b[0])
    })
}

// Fetch deck details with internal API priority (includes fallback enrichment),
// then fall back to external API if internal route is unavailable.
async function fetchDeckDetails(deckId: string): Promise<any> {
  const fetchFromInternalApi = async (): Promise<any | null> => {
    try {
      const response = await fetch(`/api/deck/${encodeURIComponent(deckId)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      })

      if (!response.ok) return null

      const payload = await response.json().catch(() => null)
      return payload?.deck || null
    } catch {
      return null
    }
  }

  const fetchFromExternalApi = async (): Promise<any | null> => {
    try {
      const url = `https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/deck/${deckId}?inclCards=true&inclUsers=true`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        return null
      }

      return await response.json()
    } catch {
      return null
    }
  }

  try {
    const internal = await fetchFromInternalApi()
    if (internal) return internal
    return await fetchFromExternalApi()
  } catch {
    return null
  }
}

// Helper function to process HTML content: remove line breaks and fix icon image URLs
const processHtmlContent = (html: string): string => {
  let processed = html
  
  // Remove line breaks: <br>, <br/>, <br />, \n, \r\n
  processed = processed.replace(/<br\s*\/?>/gi, ' ')
  processed = processed.replace(/\r\n/g, ' ')
  processed = processed.replace(/\n/g, ' ')
  processed = processed.replace(/\r/g, ' ')
  
  // Replace icon image URLs in img src attributes (use local icons)
  const iconMap: Record<string, string> = {
    'attack.png': '/images/icons/attack.png',
    'health.png': '/images/icons/health.png',
    'armor.png': '/images/icons/armor.png',
    'lv1-icon.png': '/images/cards/levels/lv1-icon.png',
    'lv2-icon.png': '/images/cards/levels/lv2-icon.png',
    'lv3-icon.png': '/images/cards/levels/lv3-icon.png',
    'lv4-icon.png': '/images/cards/levels/lv4-icon.png',
  }
  
  // Replace in img src attributes (match various patterns)
  Object.entries(iconMap).forEach(([filename, url]) => {
    // Match img tags with src containing the filename
    // Pattern: <img ... src="...attack.png..." ...>
    const imgPattern = new RegExp(
      `(<img[^>]+src=["'])([^"']*${filename.replace('.', '\\.')})(["'][^>]*>)`,
      'gi'
    )
    
    processed = processed.replace(imgPattern, (match, prefix, path, suffix) => {
      // Only replace if it's not already a full URL
      if (!path.includes('http://') && !path.includes('https://')) {
        return `${prefix}${url}${suffix}`
      }
      return match
    })
    
    // Also match standalone src attributes (in case img tag is split)
    const srcPattern = new RegExp(
      `(src=["'])([^"']*${filename.replace('.', '\\.')})(["'])`,
      'gi'
    )
    
    processed = processed.replace(srcPattern, (match, prefix, path, suffix) => {
      // Only replace if it's not already a full URL
      if (!path.includes('http://') && !path.includes('https://')) {
        return `${prefix}${url}${suffix}`
      }
      return match
    })
  })
  
  return processed
}

// Pure helper function - moved outside component for better performance
function getFactionBadgeColor(faction?: string): string {
  switch (faction) {
    case 'Alloyin': return '#06b6d4'
    case 'Uterra': return '#14b8a6'
    case 'Tempys': return '#f97316'
    case 'Nekrium': return '#a855f7'
    default: return '#6b7280'
  }
}

const RARITY_BADGE_COLORS: Record<string, string> = {
  commoncommon: '#2f92d0',
  common: '#1096e1',
  commonrare: '#e5b522',
  rarecommon: '#6a5320',
  rare: '#f0c320',
  rarerare: '#d9a600',
  darkforge: '#1a1a1a',
  darkforgecommon: '#1a1a1a',
  darkforgerare: '#101010',
  darkforgels: '#b00008',
  ls: '#b00008',
  solbind: '#2fcad0',
}

function normalizeRarityKey(rarity?: string | null): string {
  if (!rarity) return ''
  return rarity.replace(/[\s_]+/g, '').toLowerCase()
}

function getRarityBadgeColor(rarity?: string): string {
  const key = normalizeRarityKey(rarity)
  return RARITY_BADGE_COLORS[key] || '#1199e3'
}

// Global cache for card images (persists across modal opens)
const globalImageCache = new Map<string, string>()
const globalImagePromiseCache = new Map<string, Promise<string | null>>()
const globalImageUrlCache = new Map<string, string>() // remote URL -> cached object/data URL
const globalImageUrlPromiseCache = new Map<string, Promise<string | null>>()
const makeImageCacheKey = (cardId: string, level: number, isForgeborn: boolean) =>
  `${cardId}::${level}::${isForgeborn ? 'f' : 'r'}`
const staticIconCache = new Map<string, string>()
const staticIconLoading = new Map<string, Promise<string>>()
const normalizeId = (value?: string | null) => (value || '').toLowerCase()

async function fetchAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read data URL'))
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

// Treat placeholder ids like "card-0" as non-loadable
const isPlaceholderCardId = (cardId?: string | null): boolean => {
  if (!cardId) return true
  return /^card-\d+$/i.test(cardId.trim())
}

// Load image via HTMLImageElement to avoid CORS issues with fetch
async function loadImageUrlWithCache(url: string, timeoutMs: number): Promise<string | null> {
  if (!url) return null

  const cached = globalImageUrlCache.get(url)
  if (cached) return cached

  const inFlight = globalImageUrlPromiseCache.get(url)
  if (inFlight) return inFlight

  const promise = new Promise<string | null>((resolve) => {
    const img = new window.Image()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, timeoutMs)

    img.onload = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      globalImageUrlCache.set(url, url)
      resolve(url)
    }
    img.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    }
    img.src = url
  }).finally(() => {
    globalImageUrlPromiseCache.delete(url)
  })

  globalImageUrlPromiseCache.set(url, promise)
  return promise
}

// Helper function to load a single image (stable, outside component to avoid TDZ)
async function loadSingleImage(cardId: string, level: number, isForgeborn: boolean): Promise<string | null> {
  if (isPlaceholderCardId(cardId)) {
    return null
  }

  const cacheKey = makeImageCacheKey(cardId, level, isForgeborn)
  const cachedUrl = globalImageCache.get(cacheKey)
  if (cachedUrl) {
    return cachedUrl
  }

  const imageUrl = getCardImageUrl(cardId, level, isForgeborn)
  const isSet99 = /^s99/i.test(cardId)
  const timeoutMs = isForgeborn ? 10000 : 5000
  const candidates: string[] = []

  const addCandidate = (url?: string | null) => {
    if (url && !candidates.includes(url)) {
      candidates.push(url)
    }
  }

  if (isForgeborn) {
    addCandidate(getForgebornAlternativeUrl(cardId))
    addCandidate(imageUrl)
  } else {
    addCandidate(imageUrl)
  }

  if (isSet99 && !isForgeborn) {
    const baseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards'
    const cardLevel = Math.max(1, Math.min(3, level))
    const cleanId = cardId.replace(/[^a-z0-9\-_]/gi, '').toLowerCase()
    addCandidate(`${baseUrl}/${cleanId}_${cardLevel}.jpg`)
    const encodedId = encodeURIComponent(cardId)
    if (encodedId !== cleanId) {
      addCandidate(`${baseUrl}/${encodedId}_${cardLevel}.jpg`)
    }
  }

  // Forgeborn candidates are handled above to prefer the space variant first.

  for (const candidate of candidates) {
    const loadedUrl = await loadImageUrlWithCache(candidate, timeoutMs)
    if (loadedUrl) {
      globalImageCache.set(cacheKey, loadedUrl)
      return loadedUrl
    }
  }

  return null
}

// Memoized CardListItem component - defined outside to prevent recreation on each render
interface CardListItemProps {
  card: CardInfo
  isSelected: boolean
  factionIconPath: string | null
  rarityIconPath: string | null
  factionColor: string
  inlineFrame?: React.ReactNode
  onClick: () => void
}

const CardListItem = memo(function CardListItem({ 
  card, 
  isSelected, 
  factionIconPath, 
  rarityIconPath, 
  factionColor,
  inlineFrame,
  onClick 
}: CardListItemProps) {
  return (
    <div
      data-card-id={card.id}
      style={{
        // CSS containment for better performance - browser can skip rendering off-screen items
        contentVisibility: 'auto',
        containIntrinsicSize: '0 40px', // Approximate height for layout
        scrollMarginTop: '160px',
      }}
    >
      <Button
        variant={isSelected ? 'filled' : 'subtle'}
        onClick={onClick}
        className="w-full h-auto"
        data-card-scroll={card.id}
        styles={{
          root: {
            backgroundColor: isSelected 
              ? 'rgba(74, 144, 226, 0.2)' 
              : 'transparent',
            border: isSelected 
              ? '1px solid rgba(74, 144, 226, 0.5)' 
              : '1px solid transparent',
            '&:hover': {
              backgroundColor: 'rgba(74, 144, 226, 0.1)',
            },
            justifyContent: 'flex-start',
            paddingLeft: '0.5rem',
            paddingRight: '0.5rem',
            paddingTop: '0.5rem',
            paddingBottom: '0.5rem',
            cursor: 'pointer',
            userSelect: 'none',
          },
          inner: {
            justifyContent: 'flex-start',
            width: '100%',
          },
        }}
      >
        <Group gap="xs" className="w-full" wrap="nowrap" justify="flex-start" style={{ margin: 0 }}>
          {factionIconPath ? (
            <Image
              src={factionIconPath}
              alt="Faction"
              w={16}
              h={16}
              style={{ flexShrink: 0 }}
            />
          ) : (
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: factionColor, opacity: 0.8 }}
            />
          )}
          {rarityIconPath ? (
            <Image
              src={rarityIconPath}
              alt="Rarity"
              w={16}
              h={16}
              style={{ flexShrink: 0 }}
            />
          ) : (
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: factionColor, opacity: 0.8 }}
            />
          )}
          <Text 
            size="sm" 
            className="text-white flex-1 text-left truncate"
            style={{ minWidth: 0 }}
          >
            {card.name}
          </Text>
        </Group>
      </Button>
      {inlineFrame}
    </div>
  )
})

interface DeckDetailsProps {
  deck: Deck | null
  opened: boolean
  onClose: () => void
  onDeckClick: (deck: Deck, parentDeck?: Deck | null) => void
  allDecks?: Deck[]
  parentFusedDeck?: Deck | null
  deckCreatureTypesMap?: Record<string, CreatureTypeMap>
  deckCreatureTypeOverrides?: Record<string, CreatureTypeMap>
}

export function DeckDetails({ deck, opened, onClose, onDeckClick, allDecks = [], parentFusedDeck, deckCreatureTypesMap, deckCreatureTypeOverrides }: DeckDetailsProps) {
  const [selectedCard, setSelectedCard] = useState<CardInfo | null>(null)
  const [selectedLevel, setSelectedLevel] = useState<number>(1) // Current card level (1, 2, or 3)
  const [cardImages, setCardImages] = useState<Record<string, Record<number, string>>>({}) // cardId -> level -> imageUrl
  const [loadingLevels, setLoadingLevels] = useState<Record<string, Record<number, boolean>>>({}) // cardId -> level -> loading
  const [, setIconVersion] = useState(0) // bump to force rerender when static icons are loaded into data URLs
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())
  const [imageLoadStatus, setImageLoadStatus] = useState<Record<string, boolean>>({})
  const [fullDeckData, setFullDeckData] = useState<Deck | null>(null) // Full deck data with forgeborn.solbindCards
  const [fusedSourceDecks, setFusedSourceDecks] = useState<Deck[]>([])
  const [halfDetails, setHalfDetails] = useState<Record<string, any>>({})
  const [copied, setCopied] = useState(false)
  const levelManuallyChangedRef = useRef<boolean>(false)
  const lastSelectedCardIdRef = useRef<string | null>(null)
  const cardImagesRef = useRef<Record<string, Record<number, string>>>({})
  const loadingInFlightRef = useRef<Set<string>>(new Set())
  const imageRequestCacheRef = useRef<Map<string, Promise<string | null>>>(new Map())
  const fusedSourceDecksRef = useRef<string>('') // Track last merged source IDs to avoid re-setting state
  const fusedCardsMergedRef = useRef<boolean>(false) // Prevent repeated card merging for fused decks
  const fullDeckLoadRequestRef = useRef<number>(0)
  const fusedSourcesLoadRequestRef = useRef<number>(0)
  const halfDetailsLoadRequestRef = useRef<number>(0)
  const latestDeckIdRef = useRef<string | null>(normalizeDeckId(deck?.id))
  const isSmUp = useMediaQuery('(min-width: 48em)')
  const isMdUp = useMediaQuery('(min-width: 62em)')
  const modalBodyMaxHeight = isMdUp ? 'calc(80vh + 50px)' : 'calc(85vh - 24px)'
  const modalBodyInnerHeight = isMdUp ? 'calc(80vh + 50px - 3rem)' : undefined
  const modalWidth = isMdUp
    ? 'min(1500px, calc(100vw - 64px))'
    : isSmUp
      ? 'min(1100px, calc(100vw - 48px))'
      : 'calc(100vw - 24px)'
  const modalMinWidth = isMdUp ? 'min(1100px, calc(100vw - 64px))' : 'auto'
  const detailPaneStyle: React.CSSProperties = isMdUp
    ? { position: 'sticky', top: '1.5rem', alignSelf: 'flex-start', maxHeight: 'calc(80vh + 50px - 4.5rem)' }
    : { position: 'static', alignSelf: 'stretch', maxHeight: 'none' }
  const detailPanelWidth = isMdUp ? 'min(60vw, 900px)' : '100%'
  const detailPanelMinWidth = isMdUp ? '520px' : '0'
  latestDeckIdRef.current = normalizeDeckId(deck?.id)
  useEffect(() => {
    cardImagesRef.current = cardImages
  }, [cardImages])

  useEffect(() => {
    if (!opened) return
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
    }
  }, [opened])

  useEffect(() => {
    if (!selectedCard || isMdUp) return
    const id = selectedCard.id
    if (!id) return
    const target = document.querySelector(`[data-card-id="${id}"]`)
    if (target && 'scrollIntoView' in target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const offset = 96
      window.scrollBy({ top: -offset, behavior: 'smooth' })
    }
  }, [selectedCard, isMdUp])

  const activeFullDeckData = useMemo(() => {
    if (!fullDeckData) return null
    const activeDeckId = normalizeDeckId(deck?.id)
    const fullDeckId = normalizeDeckId(fullDeckData.id)
    if (activeDeckId && fullDeckId && activeDeckId !== fullDeckId) {
      return null
    }
    return fullDeckData
  }, [deck?.id, fullDeckData])

  // Always use the richest deck payload; keep full deck details but preserve newer fallback fields.
  const deckForDisplay = useMemo(() => {
    const base = mergeDeckForDisplay(deck, activeFullDeckData)
    if (!base) return null
    return addComputedFields(base)
  }, [activeFullDeckData, deck])

  // Reset fused-specific caches when a different deck is opened
  useEffect(() => {
    fullDeckLoadRequestRef.current += 1
    fusedSourcesLoadRequestRef.current += 1
    halfDetailsLoadRequestRef.current += 1
    fusedCardsMergedRef.current = false
    fusedSourceDecksRef.current = ''
    setFusedSourceDecks([])
    setHalfDetails({})
    // Reset selection and loading state when switching to a different deck
    setSelectedCard(null)
    setSelectedLevel(1)
    setLoadingLevels({})
    setImageErrors(new Set())
    setImageLoadStatus({})
    setFullDeckData(null)
    setCardImages({})
    cardImagesRef.current = {}
    loadingInFlightRef.current.clear()
    imageRequestCacheRef.current.clear()
  }, [deck?.id])

  const makeLoadingKey = useCallback((cardId: string, level: number) => `${cardId}-${level}`, [])
  const isInFlight = useCallback((cardId: string, level: number) => loadingInFlightRef.current.has(makeLoadingKey(cardId, level)), [makeLoadingKey])
  const startInFlight = useCallback((cardId: string, level: number) => {
    loadingInFlightRef.current.add(makeLoadingKey(cardId, level))
  }, [makeLoadingKey])
  const finishInFlight = useCallback((cardId: string, level: number) => {
    loadingInFlightRef.current.delete(makeLoadingKey(cardId, level))
  }, [makeLoadingKey])
  const getCachedIconPath = useCallback(
    (key: string | null, rawPath: string | null): string | null => {
      if (!key || !rawPath) return rawPath
      const cached = staticIconCache.get(key)
      if (cached) return cached
      if (!staticIconLoading.has(key)) {
        const promise = fetchAsDataUrl(rawPath)
          .then((dataUrl) => {
            staticIconCache.set(key, dataUrl)
            staticIconLoading.delete(key)
            setIconVersion(v => v + 1)
            return dataUrl
          })
          .catch(() => {
            staticIconLoading.delete(key)
            return rawPath
          })
        staticIconLoading.set(key, promise)
      }
      return rawPath
    },
    [setIconVersion]
  )

  const loadImageOnce = useCallback((cardId: string, level: number, isForgeborn: boolean) => {
    const key = `${cardId}-${level}-${isForgeborn ? 'f' : 'r'}`
    const globalKey = makeImageCacheKey(cardId, level, isForgeborn)

    // Reuse in-flight or resolved promises across component instances (helps with StrictMode double-invocation)
    const existing = imageRequestCacheRef.current.get(key)
    if (existing) return existing

    const globalExisting = globalImagePromiseCache.get(globalKey)
    if (globalExisting) {
      imageRequestCacheRef.current.set(key, globalExisting)
      return globalExisting
    }

    const promise = loadSingleImage(cardId, level, isForgeborn)
      .then((url) => {
        if (!url) {
          imageRequestCacheRef.current.delete(key)
          globalImagePromiseCache.delete(globalKey)
        } else {
          // Keep resolved promise for future callers to avoid reloading the same image
          globalImagePromiseCache.set(globalKey, Promise.resolve(url))
        }
        return url
      })
      .catch((error) => {
        imageRequestCacheRef.current.delete(key)
        globalImagePromiseCache.delete(globalKey)
        throw error
      })

    imageRequestCacheRef.current.set(key, promise)
    globalImagePromiseCache.set(globalKey, promise)
    return promise
  }, [])
  const handleSelectCard = useCallback((card: CardInfo) => {
    levelManuallyChangedRef.current = false
    lastSelectedCardIdRef.current = card.id || null
    const cachedLevels = cardImages[card.id]
    if (cachedLevels) {
      const availableLevels = Object.keys(cachedLevels).map(Number).sort()
      setSelectedLevel(availableLevels[0] || 1)
    } else {
      setSelectedLevel(1)
    }
    setSelectedCard(card)
  }, [cardImages])

  // Helper function to get two source decks from fused deck
  const getFusedDeckSourceDecks = useMemo(() => {
    const deckWithData = activeFullDeckData || deck
    if (!deckWithData) return [null, null]
    
    const fusedDeckAny = deckWithData as any
    
    let deck1: Deck | null = null
    let deck2: Deck | null = null
    
    // First, try to get decks from myDecks array (contains full deck objects)
    if (fusedDeckAny.myDecks && Array.isArray(fusedDeckAny.myDecks) && fusedDeckAny.myDecks.length >= 2) {
      const myDeck1 = fusedDeckAny.myDecks[0]
      const myDeck2 = fusedDeckAny.myDecks[1]
      
      // Use myDecks directly if they have name or id (they are full deck objects)
      if (myDeck1 && typeof myDeck1 === 'object' && (myDeck1.name || myDeck1.id)) {
        // First, try to find a more complete version in allDecks
        const deck1Id = myDeck1.id || myDeck1.deckId
        if (deck1Id && allDecks.length > 0) {
          const foundDeck1 = allDecks.find(d => d.id === deck1Id)
          const foundHasCards =
            foundDeck1 &&
            ((Array.isArray(foundDeck1.cards) && foundDeck1.cards.length > 0) ||
              (Array.isArray((foundDeck1 as any).cardList) && (foundDeck1 as any).cardList.length > 0) ||
              (Array.isArray((foundDeck1 as any).cardIds) && (foundDeck1 as any).cardIds.length > 0))
          deck1 = foundHasCards ? foundDeck1! : (myDeck1 as Deck)
        } else {
          // Use myDeck1 directly
          deck1 = myDeck1 as Deck
        }
      }
      
      if (myDeck2 && typeof myDeck2 === 'object' && (myDeck2.name || myDeck2.id)) {
        // First, try to find a more complete version in allDecks
        const deck2Id = myDeck2.id || myDeck2.deckId
        if (deck2Id && allDecks.length > 0) {
          const foundDeck2 = allDecks.find(d => d.id === deck2Id)
          const foundHasCards =
            foundDeck2 &&
            ((Array.isArray(foundDeck2.cards) && foundDeck2.cards.length > 0) ||
              (Array.isArray((foundDeck2 as any).cardList) && (foundDeck2 as any).cardList.length > 0) ||
              (Array.isArray((foundDeck2 as any).cardIds) && (foundDeck2 as any).cardIds.length > 0))
          deck2 = foundHasCards ? foundDeck2! : (myDeck2 as Deck)
        } else {
          // Use myDeck2 directly
          deck2 = myDeck2 as Deck
        }
      }
    } 
    // If myDecks doesn't work, try fusedDeckIds
    if ((!deck1 || !deck2) && fusedDeckAny.fusedDeckIds && Array.isArray(fusedDeckAny.fusedDeckIds) && fusedDeckAny.fusedDeckIds.length >= 2 && allDecks.length > 0) {
      // Get decks by IDs from allDecks
      if (!deck1) {
        deck1 = allDecks.find(d => d.id === fusedDeckAny.fusedDeckIds[0]) || null
      }
      if (!deck2) {
        deck2 = allDecks.find(d => d.id === fusedDeckAny.fusedDeckIds[1]) || null
      }
    }
    
    // Return result - logging will be done in useEffect
    
    // Fallback to already fetched halves if missing
    if (!deck1 && fusedSourceDecks.length > 0) deck1 = fusedSourceDecks[0] || null
    if (!deck2 && fusedSourceDecks.length > 1) deck2 = fusedSourceDecks[1] || null

    return [deck1, deck2]
  }, [deck, activeFullDeckData, allDecks, fusedSourceDecks])

  const renderSourceDeckMeta = (sourceDeck: Deck | null) => {
    if (!sourceDeck) return null

    const deckScore = (sourceDeck as any).deckScore
    const elo = (sourceDeck as any).elo

    const badges: React.ReactElement[] = []

    if (deckScore !== undefined && deckScore !== null) {
      badges.push(
        <Badge
          key="score"
          color="grape"
          variant="light"
          size="xs"
        >
          Score: {typeof deckScore === 'number' ? Math.round(deckScore * 100) : deckScore}
        </Badge>
      )
    }

    if (elo !== undefined && elo !== null) {
      badges.push(
        <Badge
          key="elo"
          color="violet"
          variant="light"
          size="xs"
        >
          ELO: {typeof elo === 'number' ? Math.round(elo) : elo}
        </Badge>
      )
    }

    if (badges.length === 0) return null

    return (
      <Group gap="xs" wrap="wrap">
        {badges}
      </Group>
    )
  }

  // Load full deck data when modal opens to get forgeborn.solbindCards
  useEffect(() => {
    // Only fetch when modal is open and we have a deck
    if (!deck || !opened || !deck.id) {
      // Don't reset fullDeckData on close - keep it cached for faster reopening
      return
    }

    const requestDeckId = normalizeDeckId(deck.id)
    if (!requestDeckId) return
    const requestId = ++fullDeckLoadRequestRef.current
    const deckSnapshot = deck
    const isStaleRequest = () =>
      fullDeckLoadRequestRef.current !== requestId || latestDeckIdRef.current !== requestDeckId

    // If we already loaded full data for this deck, do nothing
    if (activeFullDeckData && normalizeDeckId(activeFullDeckData.id) === requestDeckId) {
      return
    }

    // Check if we already have forgeborn.solbindCards in current deck
    const deckAny = deck as any
    const hasSolbindCards = deckAny.forgeborn && 
                           typeof deckAny.forgeborn === 'object' && 
                           deckAny.forgeborn.solbindCards && 
                           Array.isArray(deckAny.forgeborn.solbindCards) &&
                           deckAny.forgeborn.solbindCards.length > 0

    if (hasSolbindCards) {
      // Use existing deck data
      if (!isStaleRequest()) {
        setFullDeckData(addComputedFields(deckSnapshot))
      }
      if (process.env.NODE_ENV === 'development') {
        logWithTimestamp('[DeckDetails] ✅ Deck already has forgeborn.solbindCards:', deckAny.forgeborn.solbindCards.length)
      }
    } else {
      // Fetch full deck details to get forgeborn.solbindCards
      if (process.env.NODE_ENV === 'development') {
        logWithTimestamp('[DeckDetails] 🔄 Fetching full deck data for:', requestDeckId)
      }

      fetchDeckDetails(requestDeckId).then((fullData) => {
        if (!fullData || isStaleRequest()) return
        const fullDataId = normalizeDeckId((fullData as any)?.id)
        if (fullDataId && fullDataId !== requestDeckId) return

          // Merge forgeborn data with existing deck data
          const updatedDeck = {
            ...deckSnapshot,
            ...fullData,
            forgeborn: fullData.forgeborn || deckSnapshot.forgeborn,
            cards: fullData.cardList || fullData.cards || deckSnapshot.cards,
            myDecks: (fullData as any).myDecks || (deckSnapshot as any).myDecks,
            fusedDeckIds: (fullData as any).fusedDeckIds || (deckSnapshot as any).fusedDeckIds
          } as Deck

          if (isStaleRequest()) return
          setFullDeckData(addComputedFields(updatedDeck))

          if (process.env.NODE_ENV === 'development') {
            logWithTimestamp('[DeckDetails] ✅ Loaded full deck data:', {
              deckId: requestDeckId,
              hasForgeborn: !!fullData.forgeborn,
              solbindCardsCount: fullData.forgeborn?.solbindCards?.length || 0,
              forgeborn: fullData.forgeborn ? {
                id: fullData.forgeborn.id,
                name: fullData.forgeborn.name,
                solbindCards: fullData.forgeborn.solbindCards?.map((sc: any) => ({
                  id: sc.id,
                  name: sc.name,
                  cardType: sc.cardType
                }))
              } : null
            })
          }

          if ((deckSnapshot as any).format === 'Fused' && Array.isArray((fullData as any).myDecks) && !isStaleRequest()) {
            const newSources = (fullData as any).myDecks as Deck[]
            const ids = newSources
              .map((d, idx) => `${d?.id || `idx-${idx}`}:${Array.isArray(d?.cards) ? d.cards.length : 0}:${Array.isArray((d as any)?.cardList) ? (d as any).cardList.length : 0}`)
              .join('|')
            fusedSourceDecksRef.current = ids
            setFusedSourceDecks(newSources)
          }
      }).catch((error) => {
        if (isStaleRequest()) return
        console.warn('[DeckDetails] ❌ Error loading full deck data:', error)
        // Fallback to existing deck data
        setFullDeckData(addComputedFields(deckSnapshot))
      })
    }
  }, [deck, opened, activeFullDeckData])

  // Log fused deck source decks data to server
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    if (!deck || !opened) return
    if (!isFusedDeckLike(deck)) return
    
    const [deck1, deck2] = getFusedDeckSourceDecks
    const fusedDeckAny = deck as any
    const myDecks = Array.isArray(fusedDeckAny.myDecks) ? fusedDeckAny.myDecks : []
    const fusedDeckIds = Array.isArray(fusedDeckAny.fusedDeckIds) ? fusedDeckAny.fusedDeckIds : []
    const myDeckIdSample = myDecks
      .map((d: any) => d?.id || d?.deckId || null)
      .filter(Boolean)
      .slice(0, 4)
    const fusedDeckIdsSample = fusedDeckIds.filter(Boolean).slice(0, 4)
    const allDecksIdSample = allDecks.map((d) => d.id).filter(Boolean).slice(0, 6)
    const sourceIdsToCheck = Array.from(new Set([...myDeckIdSample, ...fusedDeckIdsSample])) as string[]
    const sourcePresence = sourceIdsToCheck.map((id) => ({
      id,
      inAllDecks: allDecks.some((candidate) => candidate.id === id),
    }))
    
    const logData = {
      deckName: deck.name,
      deckId: deck.id,
      deckFormat: fusedDeckAny.format,
      hasMyDecks: myDecks.length > 0,
      myDecksCount: myDecks.length,
      myDeckIdSample,
      hasFusedDeckIds: fusedDeckIds.length > 0,
      fusedDeckIdsSample,
      allDecksCount: allDecks.length,
      allDecksIdSample,
      sourcePresence,
      foundDeck1: deck1 ? { id: deck1.id, name: deck1.name } : null,
      foundDeck2: deck2 ? { id: deck2.id, name: deck2.name } : null,
      hasOnDeckClick: true
    }
    
    // Send log to server
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '[DeckDetails] getFusedDeckSourceDecks',
        data: logData,
        timestamp: new Date().toISOString()
      })
    }).catch(err => {
      console.error('[DeckDetails] Failed to send log:', err)
    })
  }, [deck, opened, getFusedDeckSourceDecks, allDecks])

  // Load source halves for fused decks when they lack card lists
  const isFusedDeck = useCallback((d: any) => {
    if (!d || !d.format) return false
    return String(d.format).toLowerCase().includes('fused')
  }, [])

  useEffect(() => {
    if (!deck || !opened || !isFusedDeck(deck)) return
    const requestDeckId = normalizeDeckId(deck.id)
    if (!requestDeckId) return
    const requestId = ++fusedSourcesLoadRequestRef.current
    const isStaleRequest = () =>
      fusedSourcesLoadRequestRef.current !== requestId || latestDeckIdRef.current !== requestDeckId

    const deckAny = (activeFullDeckData || deck) as any
    const combinedSources = [...getFusedDeckSourceDecks, ...fusedSourceDecks].filter(Boolean) as Deck[]
    const uniqueMap = new Map<string, Deck>()
    combinedSources.forEach((src, idx) => {
      if (!src) return
      const key = src.id || `idx-${idx}`
      if (!uniqueMap.has(key)) uniqueMap.set(key, src)
    })
    let sources = Array.from(uniqueMap.values())

    // If still empty but fusedDeckIds exist, try to seed placeholders to fetch
    if (sources.length === 0 && Array.isArray(deckAny?.fusedDeckIds) && deckAny.fusedDeckIds.length >= 2) {
      sources = deckAny.fusedDeckIds.map((id: string) => ({ id } as Deck))
    }
    if (sources.length === 0) return

    const existingMap = new Map<string, Deck>()
    fusedSourceDecks.forEach(d => d?.id && existingMap.set(d.id, d))

    const baseList: Deck[] = []
    sources.forEach(src => {
      if (!src) return
      const cached = src.id ? existingMap.get(src.id) : undefined
      baseList.push(cached || src)
    })

    const needsFetch = baseList.filter(src => {
      if (!src || !src.id) return false
      const hasCardsArray = Array.isArray(src.cards) && src.cards.length > 0
      const hasCardList = Array.isArray((src as any).cardList) && (src as any).cardList.length > 0
      return !(hasCardsArray || hasCardList)
    })

    const finalize = (merged: Deck[]) => {
      if (isStaleRequest()) return
      const ids = merged
        .map((d, idx) => {
          const cardsLen = Array.isArray(d?.cards) ? d.cards.length : 0
          const cardListLen = Array.isArray((d as any)?.cardList) ? (d as any).cardList.length : 0
          return `${d?.id || `idx-${idx}`}:${cardsLen}:${cardListLen}`
        })
        .join('|')
      if (ids === fusedSourceDecksRef.current) return
      fusedSourceDecksRef.current = ids
      setFusedSourceDecks(merged.filter(Boolean) as Deck[])
    }

    if (needsFetch.length === 0) {
      finalize(baseList)
      return
    }

    Promise.all(
      needsFetch.map(src => fetchDeckDetails(src!.id as string).catch(() => null))
    ).then(fetched => {
      if (isStaleRequest()) return
      const fetchedMap = new Map<string, Deck>()
      fetched.forEach(d => {
        if (d?.id) fetchedMap.set(d.id, d)
      })
      const merged = baseList.map(src => {
        if (src?.id && fetchedMap.has(src.id)) return fetchedMap.get(src.id) as Deck
        return src
      })
      finalize(merged)
    })
  }, [deck, opened, activeFullDeckData, getFusedDeckSourceDecks, fusedSourceDecks, isFusedDeck])

  // If fused deck still has no cards but sources do, merge source cards into fullDeckData
  useEffect(() => {
    const deckToUse = activeFullDeckData || deck
    if (!deckToUse || !opened || !isFusedDeck(deckToUse)) return
    if (fusedCardsMergedRef.current) return
    const hasCards =
      (Array.isArray(deckToUse.cards) && deckToUse.cards.length > 0) ||
      (Array.isArray((deckToUse as any).cardList) && (deckToUse as any).cardList.length > 0)
    if (hasCards) return

    const combinedCards: any[] = []
    fusedSourceDecks.forEach(src => {
      if (!src) return
      if (Array.isArray(src.cards) && src.cards.length > 0) combinedCards.push(...src.cards)
      else if (Array.isArray((src as any).cardList) && (src as any).cardList.length > 0) combinedCards.push(...(src as any).cardList)
    })

    if (combinedCards.length === 0) return

    fusedCardsMergedRef.current = true
    const mergedDeck = { ...(activeFullDeckData || deck), cards: combinedCards } as Deck
    setFullDeckData(mergedDeck)
  }, [deck, opened, activeFullDeckData, fusedSourceDecks, isFusedDeck])

  // Fetch and cache half details with cardIds if local candidates lack them
  useEffect(() => {
    if (!deck || !opened || !isFusedDeck(deck)) return
    const requestDeckId = normalizeDeckId(deck.id)
    if (!requestDeckId) return
    const requestId = ++halfDetailsLoadRequestRef.current
    const isStaleRequest = () =>
      halfDetailsLoadRequestRef.current !== requestId || latestDeckIdRef.current !== requestDeckId

    const deckAny = (activeFullDeckData || deck) as any

    const pool: any[] = []
    if (Array.isArray(deckAny?.myDecks)) deckAny.myDecks.forEach((s: any) => s && pool.push(s))
    if (Array.isArray((deck as any)?.myDecks)) (deck as any).myDecks.forEach((s: any) => s && pool.push(s))
    const [s1, s2] = getFusedDeckSourceDecks
    if (s1) pool.push(s1)
    if (s2) pool.push(s2)
    fusedSourceDecks.forEach((s) => s && pool.push(s))
    if (Array.isArray(deckAny?.fusedDeckIds)) {
      deckAny.fusedDeckIds.forEach((id: string) => id && pool.push({ id }))
    }

    const allDecksMap = new Map<string, Deck>()
    allDecks.forEach((d) => d?.id && allDecksMap.set(d.id, d))
    const normalizedPool = pool.map((c) => {
      const cid = c?.id
      const replacement = cid ? allDecksMap.get(cid) : null
      const hasReplacementCards =
        replacement &&
        ((Array.isArray((replacement as any).cardIds) && (replacement as any).cardIds.length > 0) ||
          (Array.isArray((replacement as any).cardList) && (replacement as any).cardList.length > 0) ||
          (Array.isArray((replacement as any).cards) && (replacement as any).cards.length > 0))
      return hasReplacementCards ? (replacement as any) : c
    })

    const pendingFetch: string[] = []
    const updates: Record<string, any> = {}

    normalizedPool.forEach((c) => {
      const cid = c?.id
      if (!cid) return
      const hasCardIds = Array.isArray((c as any).cardIds) && (c as any).cardIds.length > 0
      const hasCardList = Array.isArray((c as any).cardList) && (c as any).cardList.length > 0
      const hasCardsArray = Array.isArray((c as any).cards) && (c as any).cards.length > 0
      const stored = cid ? halfDetails[cid] : null
      const storedHasIds =
        stored &&
        ((Array.isArray((stored as any).cardIds) && (stored as any).cardIds.length > 0) ||
          (Array.isArray((stored as any).cardList) && (stored as any).cardList.length > 0))

      if (hasCardIds || hasCardList) {
        if (!storedHasIds) updates[cid] = c
        return
      }

      // Cards array without cardIds: use as a temporary fallback, but still try to fetch.
      if (hasCardsArray) {
        if (!stored) updates[cid] = c
        if (!storedHasIds) pendingFetch.push(cid)
        return
      }

      if (!stored) pendingFetch.push(cid)
    })

    if (pendingFetch.length === 0 && Object.keys(updates).length === 0) return

    const load = async () => {
      const fetchedResults = await Promise.all(
        pendingFetch.map(async (id) => {
          const res = await fetchDeckDetails(id)
          return res && res.id ? res : null
        })
      )

      const merged: Record<string, any> = { ...updates }
      fetchedResults.forEach((res, idx) => {
        const id = pendingFetch[idx]
        if (!id) return
        if (res) merged[id] = res
      })

      if (Object.keys(merged).length === 0 || isStaleRequest()) return
      setHalfDetails((prev) => {
        if (isStaleRequest()) return prev
        const next = { ...prev }
        Object.entries(merged).forEach(([id, val]) => {
          const incomingHasIds =
            (Array.isArray((val as any).cardIds) && (val as any).cardIds.length > 0) ||
            (Array.isArray((val as any).cardList) && (val as any).cardList.length > 0)
          const incomingHasCards = Array.isArray((val as any).cards) && (val as any).cards.length > 0
          const stored = next[id]
          const storedHasIds =
            stored &&
            ((Array.isArray((stored as any).cardIds) && (stored as any).cardIds.length > 0) ||
              (Array.isArray((stored as any).cardList) && (stored as any).cardList.length > 0))
          if (!stored || incomingHasIds || (!storedHasIds && incomingHasCards)) {
            next[id] = val
          }
        })
        return next
      })
    }

    load().catch(() => {})
  }, [deck, opened, isFusedDeck, activeFullDeckData, fusedSourceDecks, getFusedDeckSourceDecks, allDecks, halfDetails])

  // Assemble cards for the modal (clean merge for fused decks).
  const normalizedCards: CardInfo[] = useMemo(() => {
    const deckToUse = deckForDisplay || deck
    if (!deckToUse) return []

    const normalizeHalf = (half: any): any[] => {
      if (!half) return []
      if (Array.isArray(half.cardIds) && half.cardIds.length > 0) {
        const ids = half.cardIds.slice(0, 10)
        const values = half.cards && typeof half.cards === 'object' ? Object.values(half.cards) : []
        return ids.map((id: string, idx: number) => {
          const data = values[idx] && typeof values[idx] === 'object' ? values[idx] : {}
          return {
            ...data,
            id,
            cardId: id,
            name: (data as any)?.name || (data as any)?.title || id,
            title: (data as any)?.title,
          }
        })
      }
      if (Array.isArray(half.cardList)) return half.cardList
      if (Array.isArray(half.cards)) return half.cards
      if (half.cards && typeof half.cards === 'object') {
        const entries = Object.entries(half.cards)
        return entries.slice(0, 10).map(([key, val]) => {
          const data = typeof val === 'object' && val !== null ? val : {}
          const id = key || (data as any)?.id || (data as any)?.cardId || (data as any)?.name || (data as any)?.title
          return {
            ...data,
            id,
            cardId: id,
            name: (data as any)?.name || (data as any)?.title || id,
            title: (data as any)?.title,
          }
        })
      }
      return []
    }

    const collectFused = (): any[] => {
      let candidates: any[] = []
      // 1) myDecks from full data
      if (Array.isArray((activeFullDeckData as any)?.myDecks)) {
        (activeFullDeckData as any).myDecks.forEach((s: any) => s && candidates.push(s))
      }
      // 2) myDecks from the original deck (often with cardIds)
      if (Array.isArray((deck as any)?.myDecks)) {
        (deck as any).myDecks.forEach((s: any) => s && candidates.push(s))
      }
      // 3) getFusedDeckSourceDecks (from the full deck list)
      const [s1, s2] = getFusedDeckSourceDecks
      if (s1) candidates.push(s1)
      if (s2) candidates.push(s2)
      // 4) fusedSourceDecks (fetched by id)
      fusedSourceDecks.forEach(s => s && candidates.push(s))

      // Try to replace candidates with versions from allDecks when they include cardIds/cardList.
      const allDecksMap = new Map<string, any>()
      allDecks.forEach(d => d?.id && allDecksMap.set(d.id, d))
      candidates = candidates.map((c) => {
        const cid = c?.id
        const replacement = cid ? allDecksMap.get(cid) : null
        if (!replacement) return c
        const hasIds = Array.isArray((replacement as any).cardIds) && (replacement as any).cardIds.length > 0
        const hasList = Array.isArray((replacement as any).cardList) && (replacement as any).cardList.length > 0
        if (hasIds || hasList) return replacement
        return c
      })

      // Try to replace candidates with separately fetched details.
      candidates = candidates.map((c) => {
        const cid = c?.id
        const details = cid ? halfDetails[cid] : null
        if (!details) return c
        const hasIds = Array.isArray((details as any)?.cardIds) && (details as any).cardIds.length > 0
        const hasList = Array.isArray((details as any)?.cardList) && (details as any).cardList.length > 0
        const hasCardsArray = Array.isArray((details as any)?.cards) && (details as any).cards.length > 0
        if (hasIds || hasList || hasCardsArray) return details
        return c
      })

      if (candidates.length === 0) return []

      // Prefer candidates that include cardIds.
      const withIds = candidates.filter(h => Array.isArray((h as any).cardIds) && (h as any).cardIds.length > 0)
      const picked: any[] = []
      withIds.slice(0, 2).forEach(h => picked.push(h))
      if (picked.length < 2) {
        candidates.some(h => {
          if (picked.includes(h)) return false
          picked.push(h)
          return picked.length >= 2
        })
      }

      const halvesToUse = picked.slice(0, 2)
      const raw = halvesToUse.flatMap(normalizeHalf)
      const seen = new Set<string>()
      const combined: any[] = []
      raw.forEach((c: any, idx: number) => {
        const id = c?.id || c?.cardId || c?.name || `card-${idx}`
        const key = typeof id === 'string' ? id.toLowerCase() : `card-${idx}`
        if (seen.has(key)) return
        seen.add(key)
        combined.push(c)
      })
      return combined
    }

    let rawCards: any[] = isFusedDeck(deckToUse) ? collectFused() : []

    if (rawCards.length === 0) {
      if (Array.isArray(deckToUse.cardList)) rawCards = deckToUse.cardList
      else if (Array.isArray(deckToUse.cards)) rawCards = deckToUse.cards
      else if (deckToUse.cards && typeof deckToUse.cards === 'object') rawCards = Object.values(deckToUse.cards)
    }

    if (rawCards.length === 0) return []

    return rawCards.map((card: any, index: number) => {
      if (typeof card === 'string') return getCardInfo(card)
      if (card && typeof card === 'object') {
        const cardId = card.id || card.cardId || card.name || `card-${index}`
        const info = getCardInfo(cardId, card)
        if (card.solbindCards) (info as any).solbindCards = card.solbindCards
        return info
      }
      return getCardInfo(`card-${index}`)
    })
  }, [deck, deckForDisplay, activeFullDeckData, fusedSourceDecks, getFusedDeckSourceDecks, isFusedDeck, halfDetails, allDecks])

  // Deduplicate after normalization (id lowercased).
  const uniqueNormalizedCards: CardInfo[] = useMemo(() => {
    const map = new Map<string, CardInfo>()
    normalizedCards.forEach((card, idx) => {
      const rawKey = (card as any)?.id || (card as any)?.cardId || card.name || `idx-${idx}`
      const key = typeof rawKey === 'string' ? rawKey.toLowerCase() : `idx-${idx}`
      if (!map.has(key)) {
        map.set(key, card)
      }
    })
    return Array.from(map.values())
  }, [normalizedCards])

  // Type metadata from halves (used as fallback).
const originalCardMeta = useMemo(() => {
  const map = new Map<string, { cardType?: string; type?: string }>()
  const deckToUse = deckForDisplay || deck
  if (!deckToUse) return map
  const halves: any[] = []
    const [s1, s2] = getFusedDeckSourceDecks
    if (s1) halves.push(s1)
    if (s2) halves.push(s2)
    fusedSourceDecks.forEach(h => h && halves.push(h))
    if (Array.isArray((deckToUse as any).myDecks)) {
      (deckToUse as any).myDecks.forEach((h: any) => h && halves.push(h))
    }
    halves.forEach((half) => {
      if (Array.isArray(half.cardIds) && half.cardIds.length > 0) {
        const vals = half.cards && typeof half.cards === 'object' ? Object.values(half.cards) : []
        half.cardIds.forEach((id: string, idx: number) => {
          const data = vals[idx] && typeof vals[idx] === 'object' ? vals[idx] : {}
          const key = (id || '').toLowerCase()
          if (!key) return
          map.set(key, { cardType: (data as any)?.cardType || (data as any)?.card_type, type: (data as any)?.type })
        })
      } else if (half.cards && typeof half.cards === 'object') {
        Object.values(half.cards).forEach((c: any) => {
          const key = (c?.id || c?.cardId || '').toLowerCase()
          if (!key) return
          map.set(key, { cardType: c?.cardType || c?.card_type, type: c?.type })
        })
      }
  })
  return map
}, [deck, deckForDisplay, fusedSourceDecks, getFusedDeckSourceDecks])

  const markLevelsLoading = useCallback((cardId: string, levels: number[]) => {
    setLoadingLevels(prev => {
      const next = { ...prev }
      const entry = { ...(next[cardId] || {}) }
      levels.forEach(level => {
        if (entry[level] === undefined) {
          entry[level] = true
        }
      })
      next[cardId] = entry
      return next
    })
  }, [])

  const markLevelDone = useCallback((cardId: string, level: number) => {
    setLoadingLevels(prev => {
      const next = { ...prev }
      const entry = { ...(next[cardId] || {}) }
      entry[level] = false
      next[cardId] = entry
      return next
    })
  }, [])
  const markImageReady = useCallback((cardId: string, level: number, imageUrl: string) => {
    const key = `${cardId}-${level}-${imageUrl}`
    setImageLoadStatus(prev => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [])

  // First, extract all solbind card IDs to avoid circular dependency
  // Use a stable string representation for dependencies
  const solbindCardIdsSet = useMemo(() => {
    const deckToUse = activeFullDeckData || deck
    if (!deckToUse) return new Set<string>()
    const ids = new Set<string>()

    const addSolbindFromForgeborn = (source: any) => {
      const fb = source?.forgeborn
      if (!fb || typeof fb !== 'object') return
      if (Array.isArray(fb.solbindCards)) {
        fb.solbindCards.forEach((solbindCard: any) => {
          if (solbindCard && solbindCard.id) {
            ids.add(solbindCard.id)
          }
        })
      }
      const fbId1 = fb.solbindId1 || fb.solbindid1
      const fbId2 = fb.solbindId2 || fb.solbindid2
      if (fbId1) ids.add(fbId1)
      if (fbId2) ids.add(fbId2)
    }

    addSolbindFromForgeborn(deckToUse)

    if (isFusedDeckLike(deckToUse)) {
      const seen = new Set<string>()
      const candidates: any[] = []
      const pushCandidate = (candidate: any) => {
        if (!candidate) return
        const key = candidate.id || candidate.deckId || candidate.name
        if (key) {
          const keyStr = String(key)
          if (seen.has(keyStr)) return
          seen.add(keyStr)
        }
        candidates.push(candidate)
      }

      if (Array.isArray((deckToUse as any).myDecks)) {
        (deckToUse as any).myDecks.forEach((candidate: any) => pushCandidate(candidate))
      }
      if (Array.isArray((deck as any)?.myDecks)) {
        (deck as any).myDecks.forEach((candidate: any) => pushCandidate(candidate))
      }
      getFusedDeckSourceDecks.forEach((candidate) => pushCandidate(candidate))
      fusedSourceDecks.forEach((candidate) => pushCandidate(candidate))
      Object.values(halfDetails).forEach((candidate) => pushCandidate(candidate))

      candidates.forEach(addSolbindFromForgeborn)
    }
    
    // Add Solbind cards from solbindCards arrays in normalizedCards (prefer richer data if available)
    uniqueNormalizedCards.forEach(card => {
      const cardData = card as any
      const solbindList =
        Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0
          ? cardData.solbindCards
          : (() => {
              // Fallback: try to read solbindCards from stored card info (for string-only entries)
              const fallbackInfo = getCardInfo(card.id || cardData.cardId || cardData.name)
              const list = (fallbackInfo as any)?.solbindCards
              return Array.isArray(list) ? list : []
            })()
      if (typeof cardData.solbind === 'string') {
        cardData.solbind
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .forEach((sid: string) => ids.add(sid))
      }

      solbindList.forEach((solbindCard: any) => {
        if (solbindCard && solbindCard.id) {
          ids.add(solbindCard.id)
        }
      })

      // Also respect solbindId1/solbindId2 hints on the parent card
      const id1 = cardData.solbindId1 || cardData.solbindid1
      const id2 = cardData.solbindId2 || cardData.solbindid2
      if (id1) ids.add(id1)
      if (id2) ids.add(id2)
    })
    if (process.env.NODE_ENV === 'development' && ids.size > 0) {
      // logWithTimestamp(`[DeckDetails] Solbind card IDs:`, Array.from(ids))
    }
    
    return ids
  }, [uniqueNormalizedCards, deck, activeFullDeckData, getFusedDeckSourceDecks, fusedSourceDecks, halfDetails])

  // Create a stable string representation for use in dependencies
  const solbindCardIdsKey = useMemo(() => {
    return Array.from(solbindCardIdsSet).sort().join(',')
  }, [solbindCardIdsSet])

  const solbindCardIdsArray = useMemo(() => Array.from(solbindCardIdsSet).sort(), [solbindCardIdsSet])

  // Rarity summary (including Solbind) for badges in header
  const raritySummary = useMemo(() => {
    const summary = new Map<string, number>()

    const add = (key: string) => summary.set(key, (summary.get(key) || 0) + 1)

    const solbindIds = solbindCardIdsSet

    uniqueNormalizedCards.forEach((card, idx) => {
      const cardData = card as any

      const cardId = card.id || cardData.cardId || `card-${idx}`
      const rarityRaw = cardData.rarity
      const rarityLower = typeof rarityRaw === 'string' ? rarityRaw.toLowerCase() : ''

      // Solbind check
      const isSolbind =
        solbindIds.has(cardId) ||
        (typeof rarityRaw === 'string' && rarityLower.includes('solbind'))
      if (isSolbind) {
        add('Solbind')
        return
      }

      if (typeof rarityRaw === 'string') {
        let normalizedRarity = rarityRaw.trim()
        const lower = normalizedRarity.toLowerCase()

        if (lower.includes('darkforge') && lower.includes('rare')) {
          normalizedRarity = 'Darkforge Rare'
        } else if (lower.includes('darkforge') && lower.includes('common')) {
          normalizedRarity = 'Darkforge Common'
        } else if (lower.includes('darkforge') && (lower.includes('ls') || lower.includes('legendary'))) {
          normalizedRarity = 'Darkforge LS'
        } else if (lower.includes('common common')) {
          normalizedRarity = 'Common Common'
        } else if (lower.includes('rare rare')) {
          normalizedRarity = 'Rare Rare'
        } else if (lower.includes('rare') && lower.includes('common')) {
          normalizedRarity = 'Rare Common'
        } else if (lower.includes('common') && lower.includes('rare')) {
          normalizedRarity = 'Common Rare'
        } else if (lower.includes('rare') && !lower.includes('common')) {
          normalizedRarity = 'Rare'
        } else if (lower.includes('darkforge')) {
          normalizedRarity = 'Darkforge'
        } else if (lower.includes('solbind')) {
          normalizedRarity = 'Solbind'
        } else if (lower.includes('common')) {
          normalizedRarity = 'Common'
        } else if (lower.includes('ls') || lower.includes('legendary')) {
          normalizedRarity = 'LS'
        }

        add(normalizedRarity)
      }
    })

    return summary
  }, [uniqueNormalizedCards, solbindCardIdsSet])

  const deckCounts = useMemo(() => {
    let derived = { total: 0, creatures: 0, spells: 0, solbind: 0 }
    let creatures = 0
    let spells = 0
    let solbind = 0
    const solbindIds = new Set<string>()

    uniqueNormalizedCards.forEach((card, idx) => {
      const cardData = card as any
      const cardTypeRaw = (cardData.cardType || cardData.card_type || '').toLowerCase()
      const typeRaw = (cardData.type || '').toLowerCase()
      const isForgeborn = cardTypeRaw.includes('forgeborn') || typeRaw.includes('forgeborn')
      if (isForgeborn) {
        if (Array.isArray(cardData.solbindCards)) {
          cardData.solbindCards.forEach((sb: any, sbIdx: number) => {
            const sid = sb?.id || sb?.cardId || sb?.name || `solbind-${cardData.id || idx}-${sbIdx}`
            if (sid) solbindIds.add(sid)
          })
        }
        const id1 = cardData.solbindId1 || cardData.solbindid1
        const id2 = cardData.solbindId2 || cardData.solbindid2
        if (id1) solbindIds.add(id1)
        if (id2) solbindIds.add(id2)
        return
      }

      const isParentSolbind =
        Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0
      const isSpell = cardTypeRaw.includes('spell') && !cardTypeRaw.includes('creature')
      if (isParentSolbind) {
        if (isSpell) spells += 1
        else creatures += 1
        cardData.solbindCards.forEach((sb: any, sbIdx: number) => {
          const sid = sb?.id || sb?.cardId || sb?.name || `solbind-${cardData.id || idx}-${sbIdx}`
          if (sid) solbindIds.add(sid)
        })
        const id1 = cardData.solbindId1 || cardData.solbindid1
        const id2 = cardData.solbindId2 || cardData.solbindid2
        if (id1) solbindIds.add(id1)
        if (id2) solbindIds.add(id2)
        return
      }

      if (isSpell) spells += 1
      else creatures += 1
    })

    if ((deck as any)?.forgeborn?.solbindCards && Array.isArray((deck as any).forgeborn.solbindCards)) {
      (deck as any).forgeborn.solbindCards.forEach((sb: any, idx: number) => {
        const sid = sb?.id || sb?.cardId || sb?.name || `solbind-forgeborn-${idx}`
        if (sid) solbindIds.add(sid)
      })
    }
    if ((deck as any)?.forgeborn) {
      const fb: any = (deck as any).forgeborn
      if (fb.solbindId1 || fb.solbindid1) solbindIds.add(fb.solbindId1 || fb.solbindid1)
      if (fb.solbindId2 || fb.solbindid2) solbindIds.add(fb.solbindId2 || fb.solbindid2)
    }

    solbind = Math.max(solbindIds.size, solbindCardIdsSet.size)
    derived = { total: creatures + spells + solbind, creatures, spells, solbind }

    const comp = deck?.computed?.counts
    if (!comp) return derived
    return {
      total: Math.max(derived.total, comp.total ?? 0),
      creatures: Math.max(derived.creatures, comp.creatures ?? 0),
      spells: Math.max(derived.spells, comp.spells ?? 0),
      solbind: Math.max(derived.solbind, comp.solbind ?? 0),
    }
  }, [deck, uniqueNormalizedCards, solbindCardIdsSet])

  const deckTags = useMemo(() => {
    const tagSet = new Set<string>()
    const deckAny = (activeFullDeckData || deck) as any

    if (Array.isArray(deckAny?.computed?.displayTags) && deckAny.computed.displayTags.length > 0) {
      deckAny.computed.displayTags.forEach((t: string) => {
        if (t && typeof t === 'string') tagSet.add(t)
      })
    }

    if (deckAny?.tags && typeof deckAny.tags === 'object' && !Array.isArray(deckAny.tags)) {
      Object.entries(deckAny.tags).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return
        if (typeof value === 'string' && value.trim()) tagSet.add(value.trim())
        else if (typeof value === 'number' || typeof value === 'boolean') tagSet.add(String(value))
        else if (key && key !== 'none' && !key.startsWith('tag_')) tagSet.add(key)
      })
    }

    if (tagSet.size === 0) {
      uniqueNormalizedCards.forEach((card: any) => {
        if (card && typeof card === 'object') {
          const provides = card.provides || card.Provides
          if (provides) {
            if (typeof provides === 'string') {
              provides.split(',').forEach((p: string) => {
                const trimmed = p.trim()
                if (trimmed) tagSet.add(trimmed)
              })
            } else if (Array.isArray(provides)) {
              provides.forEach((p: string) => {
                if (p && typeof p === 'string') {
                  const trimmed = p.trim()
                  if (trimmed) tagSet.add(trimmed)
                }
              })
            }
          }
        }
      })
    }

    return Array.from(tagSet)
  }, [deck, activeFullDeckData, uniqueNormalizedCards])

  const creatureTypeEntries = useMemo(() => {
    const deckLike = activeFullDeckData || deck
    if (!deckLike) return []
    if (isFusedDeckLike(deckLike)) {
      const fusedEntries = buildFusedCreatureTypeEntries(deckLike, { deckCreatureTypesMap, deckCreatureTypeOverrides, allDecks })
      if (fusedEntries.length > 0) return fusedEntries
      return []
    }
    return buildCreatureTypeEntries(deckLike, { fallbackCards: uniqueNormalizedCards })
  }, [activeFullDeckData, deck, uniqueNormalizedCards, deckCreatureTypesMap, deckCreatureTypeOverrides, allDecks])

  const fusedHalfIds = useMemo(() => {
    const ids = new Set<string>()
    const addId = (value?: string | null) => {
      const trimmed = (value || '').trim()
      if (trimmed) ids.add(trimmed)
    }
    const deckAny = (activeFullDeckData || deck) as any
    if (Array.isArray(deckAny?.myDecks)) {
      deckAny.myDecks.forEach((d: any) => addId(d?.id || d?.deckId || d?.deck_id))
    }
    if (Array.isArray(deckAny?.fusedDeckIds)) {
      deckAny.fusedDeckIds.forEach((id: string) => addId(id))
    }
    getFusedDeckSourceDecks.forEach((d) => addId((d as any)?.id || (d as any)?.deckId || (d as any)?.deck_id))
    fusedSourceDecks.forEach((d) => addId((d as any)?.id || (d as any)?.deckId || (d as any)?.deck_id))
    return Array.from(ids)
  }, [activeFullDeckData, deck, getFusedDeckSourceDecks, fusedSourceDecks])

  useEffect(() => {
    if (!opened || fusedHalfIds.length === 0) return
    const store = useDeckStore.getState()
    fusedHalfIds.forEach((id) => {
      if (!id) return
      fetchCreatureTypesForDeckId(id).then((creatureType) => {
        if (creatureType && Object.keys(creatureType).length > 0) {
          store.setDeckCreatureType(id, creatureType)
        }
      })
    })
  }, [opened, fusedHalfIds])

  // Helper function to load images in parallel with a concurrency limit
  const loadImagesInParallel = async (
    tasks: Array<{ cardId: string; level: number; isForgeborn: boolean }>,
    concurrency: number,
    updateCallback: (cardId: string, level: number, imageUrl: string | null) => void,
    checkCanceled: () => boolean
  ): Promise<void> => {
    let currentIndex = 0
    const running = new Set<Promise<void>>()
    
    const runNext = async (): Promise<void> => {
      while (currentIndex < tasks.length && !checkCanceled()) {
        const taskIndex = currentIndex++
        const task = tasks[taskIndex]
        
        const promise = loadImageOnce(task.cardId, task.level, task.isForgeborn)
          .then((imageUrl) => {
            if (!checkCanceled()) {
              updateCallback(task.cardId, task.level, imageUrl)
            }
          })
          .catch(() => {
            if (!checkCanceled()) {
              updateCallback(task.cardId, task.level, null)
            }
          })
          .finally(() => {
            // Remove this promise from running set
            running.delete(promise)
          })
        
        running.add(promise)
        
        // Wait for next task slot if we've reached concurrency limit
        if (running.size >= concurrency) {
          await Promise.race(Array.from(running))
        }
      }
    }
    
    // Start all workers
    const workers = Array(Math.min(concurrency, tasks.length))
      .fill(null)
      .map(() => runNext())
    
    // Wait for all workers to complete
    await Promise.all(workers)
    
    // Wait for any remaining promises to complete
    if (running.size > 0) {
      await Promise.all(Array.from(running))
    }
  }

  // Fast lookup for forgeborn identifiers to avoid treating them as regular cards
  const forgebornIdFromDeck = deck?.forgebornId
  const forgebornObjFromDeck = (deck as any)?.forgeborn

  const forgebornIdSet = useMemo(() => {
    const ids: string[] = []
    if (forgebornIdFromDeck) ids.push(forgebornIdFromDeck)
    if (forgebornObjFromDeck?.id) ids.push(forgebornObjFromDeck.id)
    normalizedCards.forEach((card) => {
      const data = card as any
      const type = (data.cardType || data.type || '').toLowerCase()
      const rarity = (data.rarity || '').toLowerCase()
      if (type.includes('forgeborn') || rarity === 'forgeborn') ids.push(card.id)
    })
    const normalized = ids
      .filter(Boolean)
      .map(id => normalizeId(id))
    return new Set(normalized)
  }, [forgebornIdFromDeck, forgebornObjFromDeck, normalizedCards])

  const isForgebornCardId = useCallback(
    (card: CardInfo | string | null | undefined): boolean => {
      if (!card) return false
      const id = normalizeId(typeof card === 'string' ? card : card.id)
      const type = typeof card === 'string' ? '' : ((card as any).cardType || (card as any).type || '').toLowerCase()
      const rarity = typeof card === 'string' ? '' : ((card as any).rarity || '').toLowerCase()
      if (id && forgebornIdSet.has(id)) return true
      if (type.includes('forgeborn')) return true
      if (rarity === 'forgeborn') return true
      return false
    },
    [forgebornIdSet]
  )

  // Load images only for the selected card (lazy loading for performance)
  useEffect(() => {
    if (!opened || !selectedCard) return

    let isCanceled = false
    
    const loadSelectedCardImages = async () => {
      const isForgeborn = isForgebornCardId(selectedCard)
      
      const existingImages = cardImages[selectedCard.id] || {}
      const levelsToLoad = isForgeborn
        ? [1].filter(level => !existingImages[level])
        : [1, 2, 3].filter(level => !existingImages[level])
      
      if (levelsToLoad.length === 0) {
        return
      }
      
      markLevelsLoading(selectedCard.id, levelsToLoad)
      
      try {
        if (isForgeborn) {
          // Load single forgeborn image
          startInFlight(selectedCard.id, 1)
          const imageUrl = await loadImageOnce(selectedCard.id, 1, true)
          if (!isCanceled) {
            if (imageUrl) {
              setCardImages(prev => ({
                ...prev,
                [selectedCard.id]: { ...prev[selectedCard.id], 1: imageUrl, 2: imageUrl, 3: imageUrl }
              }))
              markImageReady(selectedCard.id, 1, imageUrl)
              markImageReady(selectedCard.id, 2, imageUrl)
              markImageReady(selectedCard.id, 3, imageUrl)
            }
            markLevelDone(selectedCard.id, 1)
            markLevelDone(selectedCard.id, 2)
            markLevelDone(selectedCard.id, 3)
          }
          finishInFlight(selectedCard.id, 1)
        } else {
          // Load missing levels in parallel
          levelsToLoad.forEach(level => startInFlight(selectedCard.id, level))

          const [level1, level2, level3] = await Promise.all([
            levelsToLoad.includes(1) ? loadImageOnce(selectedCard.id, 1, false) : Promise.resolve(null),
            levelsToLoad.includes(2) ? loadImageOnce(selectedCard.id, 2, false) : Promise.resolve(null),
            levelsToLoad.includes(3) ? loadImageOnce(selectedCard.id, 3, false) : Promise.resolve(null),
          ])
          
          if (!isCanceled) {
            const newImages: Record<number, string> = {}
            if (level1) newImages[1] = level1
            if (level2) newImages[2] = level2
            if (level3) newImages[3] = level3
            
            if (Object.keys(newImages).length > 0) {
              setCardImages(prev => ({
                ...prev,
                [selectedCard.id]: { ...prev[selectedCard.id], ...newImages }
              }))
              Object.entries(newImages).forEach(([lvl, url]) => {
                if (url) markImageReady(selectedCard.id, Number(lvl), url as string)
              })
            }
            if (levelsToLoad.includes(1)) markLevelDone(selectedCard.id, 1)
            if (levelsToLoad.includes(2)) markLevelDone(selectedCard.id, 2)
            if (levelsToLoad.includes(3)) markLevelDone(selectedCard.id, 3)
          }
          levelsToLoad.forEach(level => finishInFlight(selectedCard.id, level))
        }
      } catch (error) {
        if (!isCanceled) {
          setImageErrors(prev => new Set(prev).add(selectedCard.id))
        }
      } finally {
        if (isForgeborn) {
          finishInFlight(selectedCard.id, 1)
        } else {
          levelsToLoad.forEach(level => finishInFlight(selectedCard.id, level))
        }
      }
    }
    
    loadSelectedCardImages()
    
    return () => {
      isCanceled = true
    }
  }, [opened, selectedCard, deck?.forgebornId, cardImages, markLevelsLoading, markLevelDone, isInFlight, startInFlight, finishInFlight, loadImageOnce, isForgebornCardId])

  // Background preload all card images (delayed to not block UI)
  useEffect(() => {
    if (!opened || normalizedCards.length === 0) return
    
    let isCanceled = false
    
    const loadAllLevelOnesAndSolbind = async () => {
      for (const card of normalizedCards) {
        if (isCanceled) break

        const cardData = card as any
        const isForgeborn = isForgebornCardId(card)
        const isSolbind = solbindCardIdsSet.has(card.id) ||
                          cardData.rarity === 'Solbind' || cardData.rarity === 'solbind' ||
                          card.type?.toLowerCase() === 'solbind' ||
                          cardData.cardType?.toLowerCase() === 'solbind'

        if (isForgeborn) {
          continue
        }

        if (isSolbind) {
          const levelsToLoad = [1, 2, 3].filter(level => !(cardImagesRef.current[card.id]?.[level]) && !isInFlight(card.id, level))
          if (levelsToLoad.length === 0) continue

          markLevelsLoading(card.id, levelsToLoad)
          levelsToLoad.forEach(level => startInFlight(card.id, level))
          try {
            for (const level of levelsToLoad) {
              if (isCanceled) break
              const imageUrl = await loadImageOnce(card.id, level, false)
              if (!isCanceled && imageUrl) {
                setCardImages(prev => ({
                  ...prev,
                  [card.id]: { ...prev[card.id], [level]: imageUrl }
                }))
                markImageReady(card.id, level, imageUrl)
              }
              if (!isCanceled) {
                markLevelDone(card.id, level)
              }
            }
          } catch {
            // ignore background errors
          } finally {
            levelsToLoad.forEach(level => finishInFlight(card.id, level))
          }
        } else {
          const hasLevel1 = !!cardImagesRef.current[card.id]?.[1]
          if (hasLevel1 || isInFlight(card.id, 1)) continue
          markLevelsLoading(card.id, [1])
          startInFlight(card.id, 1)
          try {
            const imageUrl = await loadImageOnce(card.id, 1, false)
            if (!isCanceled && imageUrl) {
              setCardImages(prev => ({
                ...prev,
                [card.id]: { ...prev[card.id], 1: imageUrl }
              }))
              markImageReady(card.id, 1, imageUrl)
            }
          } catch {
            // ignore background errors
          } finally {
            if (!isCanceled) {
              markLevelDone(card.id, 1)
            }
            finishInFlight(card.id, 1)
          }
        }

        if (!isCanceled) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
    }

    loadAllLevelOnesAndSolbind()
    
    return () => {
      isCanceled = true
    }
  }, [opened, normalizedCards, deck?.forgebornId, markLevelsLoading, markLevelDone, solbindCardIdsSet, isInFlight, startInFlight, finishInFlight, loadImageOnce, isForgebornCardId])

  // DISABLED: Old preload all images - too slow
  // Load card images in specific order: Forgeborn -> Creatures/Spells Level 1 -> Level 2 -> Level 3 -> Solbind
  /* useEffect(() => {
    if (!opened || normalizedCards.length === 0) return

    // Track if the modal is still open to prevent state updates after closing
    let isModalOpen = true

    const loadImages = async () => {
      const errors = new Set<string>()
      
      // Helper function to update state immediately when an image loads
      // Only updates if modal is still open
      const updateImageState = (cardId: string, level: number, imageUrl: string) => {
        if (!isModalOpen) {
          logWithTimestamp(`[DeckDetails] ⏹️ Skipping image update for ${cardId} - modal closed`)
          return
        }
        setCardImages(prev => {
          const updated = { ...prev }
          if (!updated[cardId]) {
            updated[cardId] = {}
          }
          updated[cardId] = { ...updated[cardId], [level]: imageUrl }
          return updated
        })
      }
      
      // Check if modal is still open before starting
      if (!isModalOpen) {
        logWithTimestamp(`[DeckDetails] ⏹️ Modal closed before image loading started`)
        return
      }

      // Use full deck data if available
      const deckForUse = activeFullDeckData || deck

      // Categorize cards (we need to compute these here since useMemo hooks are defined later)
      const forgebornCardsList: CardInfo[] = []
      const creatureCardsList: CardInfo[] = []
      const spellCardsList: CardInfo[] = []
      const solbindCardsList: CardInfo[] = []

      // Normalize forgeborn id/name to a comparable key (handles different set prefixes)
      const normalizeForgebornKey = (id?: string, name?: string): string => {
        const lowerId = (id || '').toLowerCase()
        const lowerName = (name || '').toLowerCase()
        const knownNames = ['cercee', 'ironbeard', 'xerxes', 'kitaru', 'nova']
        const keyFromName = knownNames.find(n => lowerName.includes(n))
        const keyFromId = knownNames.find(n => lowerId.includes(n))
        if (keyFromName) return keyFromName
        if (keyFromId) return keyFromId
        return lowerId ? lowerId.replace(/[^a-z]/g, '') : ''
      }

      // Helper function to check if a forgeborn is already in the list
      // Handles different ID variants (e.g., s2nn1cercee324 vs s2nn1cercee431)
      const isForgebornInList = (
        forgebornId: string,
        forgebornList: CardInfo[],
        forgebornName?: string
      ): boolean => {
        if (!forgebornId) return false
        const targetKey = normalizeForgebornKey(forgebornId, forgebornName)
        return forgebornList.some(fb => {
          if (!fb.id) return false
          // Exact match
          if (fb.id === forgebornId) return true
          const fbKey = normalizeForgebornKey(fb.id, fb.name)
          if (targetKey && fbKey && targetKey === fbKey) return true
          // Partial match
          return (fb.id.includes(forgebornId) || forgebornId.includes(fb.id))
        })
      }

      // Try to find richer forgeborn data from deck objects (preserve abilities/cardType)
      const findForgebornDetails = (id?: string): any | null => {
        if (!id) return null
        const decksToSearch = [deckForUse, ...(deckForUse?.format === 'Fused' ? getFusedDeckSourceDecks.filter(Boolean) : [])]
        for (const d of decksToSearch) {
          const dAny = d as any
          if (dAny?.forgeborn && (dAny.forgeborn.id === id || dAny.forgebornId === id || (dAny.forgeborn.id && id.includes(dAny.forgeborn.id)))) {
            return dAny.forgeborn
          }
        }
        return null
      }

      // Helper function to add forgeborn to list if not already present, enriched with API data when available
      const addForgebornIfNotExists = (forgeborn: CardInfo | null, forgebornId?: string): void => {
        if (!forgeborn) return
        const idToCheck = forgebornId || forgeborn.id
        if (!idToCheck) return
        if (!isForgebornInList(idToCheck, forgebornCardsList, forgeborn.name)) {
          const apiDetails = findForgebornDetails(idToCheck)
          const mergedCard: CardInfo = {
            ...apiDetails,
            ...forgeborn,
            id: forgeborn.id || apiDetails?.id || idToCheck,
            cardType: apiDetails?.cardType || (forgeborn as any).cardType || 'Forgeborn',
            type: apiDetails?.type || (forgeborn as any).type || apiDetails?.cardType || 'Forgeborn',
            name: forgeborn.name || apiDetails?.name || apiDetails?.title,
          } as CardInfo
          forgebornCardsList.push(mergedCard)
        }
      }

      // First, identify Forgeborn
      if (deckForUse?.forgebornId) {
        const forgeborn = normalizedCards.find(card => 
          card.id === deckForUse.forgebornId || 
          (card.id && deckForUse.forgebornId && card.id.includes(deckForUse.forgebornId)) ||
          (deckForUse.forgebornId && card.id && deckForUse.forgebornId.includes(card.id))
        )
        if (forgeborn) {
          addForgebornIfNotExists(forgeborn, deckForUse.forgebornId)
        } else if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
          // If forgeborn not found in normalizedCards, try to get it from deckForUse.forgeborn object
          const forgebornId = deckForUse.forgeborn.id || deckForUse.forgebornId
          const forgebornFromObject = getCardInfo(forgebornId, deckForUse.forgeborn)
          addForgebornIfNotExists(forgebornFromObject, forgebornId)
        }
      } else if (deckForUse?.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
        // If no forgebornId but we have forgeborn object, use it
        const forgebornFromObject = getCardInfo(deckForUse.forgeborn.id, deckForUse.forgeborn)
        addForgebornIfNotExists(forgebornFromObject, deckForUse.forgeborn.id)
      }
      
      // For fused decks, ensure first forgeborn is found from first source deck
      // This is important because first forgeborn might not be in normalizedCards
      if (deckForUse?.format === 'Fused') {
        const [deck1, deck2] = getFusedDeckSourceDecks
        const fusedDeckAny = deckForUse as any

        const tryAddDeckForgeborn = (sourceDeck: any) => {
          if (!sourceDeck) return
          const id = sourceDeck.forgebornId || sourceDeck.forgeborn?.id
          if (!id) return
          let fbCard = normalizedCards.find(card =>
            card.id === id ||
            (card.id && id && card.id.includes(id)) ||
            (id && card.id && id.includes(card.id))
          )
          if (!fbCard && sourceDeck.forgeborn) {
            fbCard = getCardInfo(id, sourceDeck.forgeborn)
          }
          if (fbCard) {
            addForgebornIfNotExists(fbCard, id)
          }
        }

        // Always try to add both source forgeborn cards, regardless of currentForgebornId
        tryAddDeckForgeborn(deck1)
        tryAddDeckForgeborn(deck2)
        
        // Try to get first forgeborn from deck1
        let firstForgebornId: string | undefined
        let firstForgebornCard: any = null
        
        // First, try to get forgebornId from deck1 or fusedDeckAny
        firstForgebornId = deckForUse?.forgebornId || (deck1 && (deck1 as any).forgebornId)
        
        // Also check myDecks directly if deck1 doesn't have full data
        if (!firstForgebornId && fusedDeckAny.myDecks && Array.isArray(fusedDeckAny.myDecks) && fusedDeckAny.myDecks.length >= 1) {
          const myDeck1 = fusedDeckAny.myDecks[0]
          if (myDeck1 && typeof myDeck1 === 'object') {
            firstForgebornId = myDeck1.forgebornId || myDeck1.forgeborn?.id || fusedDeckAny.currentForgebornId
            
            // Also check if forgeborn is in the cards array
            if (myDeck1.cards && typeof myDeck1.cards === 'object') {
              // cards might be an object with numeric keys
              const cardsArray = Array.isArray(myDeck1.cards) 
                ? myDeck1.cards 
                : Object.values(myDeck1.cards)
              
              const forgebornInCards = cardsArray.find((c: any) => {
                if (typeof c === 'object' && c !== null) {
                  const cardType = c.cardType || c.CardType || c.type || c.Type
                  return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
                }
                return false
              })
              
              if (forgebornInCards) {
                firstForgebornCard = forgebornInCards
                firstForgebornId = firstForgebornId || forgebornInCards.id || forgebornInCards.cardId || forgebornInCards.name
              }
            }
          }
        }
        
        // If we have firstForgebornId, try to find it
        // Check if first forgeborn is already in the list
        const firstForgebornAlreadyInList = firstForgebornId && isForgebornInList(firstForgebornId, forgebornCardsList)
        
        if (firstForgebornId && !firstForgebornAlreadyInList) {
          // First, try to find first forgeborn in normalizedCards
          let firstForgeborn = normalizedCards.find(card => 
            card.id === firstForgebornId || 
            (card.id && firstForgebornId && card.id.includes(firstForgebornId)) ||
            (firstForgebornId && card.id && firstForgebornId.includes(card.id))
          )
          
          // If not found in normalizedCards and we have firstForgebornCard, use it
          if (!firstForgeborn && firstForgebornCard) {
            const cardId = firstForgebornCard.id || firstForgebornCard.cardId || firstForgebornCard.name || firstForgebornId
            firstForgeborn = getCardInfo(cardId, firstForgebornCard)
          }
          
          // If still not found, try to find it in deck1.cards
          if (!firstForgeborn && deck1 && deck1.cards && Array.isArray(deck1.cards)) {
            const deck1Card = deck1.cards.find((c: any) => {
              if (typeof c === 'string') {
                return c === firstForgebornId
              } else if (typeof c === 'object' && c !== null) {
                const cId = c.id || c.cardId || c.name
                return cId === firstForgebornId || 
                       (cId && firstForgebornId && cId.includes(firstForgebornId)) ||
                       (firstForgebornId && cId && firstForgebornId.includes(cId))
              }
              return false
            })
            
            if (deck1Card) {
              const cardId = typeof deck1Card === 'string' ? deck1Card : (deck1Card.id || deck1Card.cardId || deck1Card.name)
              firstForgeborn = getCardInfo(cardId, typeof deck1Card === 'object' ? deck1Card : undefined)
            }
          }
          
          // If still not found, try to get forgeborn by cardType from deck1
          if (!firstForgeborn && deck1 && deck1.cards && Array.isArray(deck1.cards)) {
            const forgebornByTypeCard = deck1.cards.find((c: any) => {
              if (typeof c === 'object' && c !== null) {
                const cardType = c.cardType || c.CardType || c.type || c.Type
                return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
              }
              return false
            })
            
            if (forgebornByTypeCard && typeof forgebornByTypeCard === 'object') {
              const cardId = forgebornByTypeCard.id || forgebornByTypeCard.cardId || forgebornByTypeCard.name
              firstForgeborn = getCardInfo(cardId, forgebornByTypeCard)
            }
          }
          
          if (firstForgeborn) {
            addForgebornIfNotExists(firstForgeborn, firstForgebornId)
            if (isForgebornInList(firstForgebornId, forgebornCardsList)) {
              logWithTimestamp(`[DeckDetails] 🔥 Found first forgeborn for fused deck: ${firstForgeborn.id} (${firstForgeborn.name})`)
            } else {
              logWithTimestamp(`[DeckDetails] ℹ️ First forgeborn ${firstForgeborn.id} already in list, skipping`)
            }
          } else {
            logWithTimestamp(`[DeckDetails] ⚠️ First forgeborn not found for fused deck with ID: ${firstForgebornId}`)
          }
        }
      }
      
      // For fused decks, add second forgeborn from the second source deck
      if (deckForUse?.format === 'Fused') {
        const [deck1, deck2] = getFusedDeckSourceDecks
        const fusedDeckAny = deckForUse as any
        
        // Try to get second forgeborn from deck2
        let secondForgebornId: string | undefined
        let secondForgebornCard: any = null
        
        // First, try to get forgebornId from deck2
        if (deck2 && (deck2 as any).forgebornId) {
          secondForgebornId = (deck2 as any).forgebornId
        }
        
        // Also check myDecks directly if deck2 doesn't have full data
        if (!secondForgebornId && fusedDeckAny.myDecks && Array.isArray(fusedDeckAny.myDecks) && fusedDeckAny.myDecks.length >= 2) {
          const myDeck2 = fusedDeckAny.myDecks[1]
          if (myDeck2 && typeof myDeck2 === 'object') {
            secondForgebornId = myDeck2.forgebornId || myDeck2.forgeborn?.id
            
            // Also check if forgeborn is in the cards array
            if (myDeck2.cards && typeof myDeck2.cards === 'object') {
              // cards might be an object with numeric keys
              const cardsArray = Array.isArray(myDeck2.cards) 
                ? myDeck2.cards 
                : Object.values(myDeck2.cards)
              
              const forgebornInCards = cardsArray.find((c: any) => {
                if (typeof c === 'object' && c !== null) {
                  const cardType = c.cardType || c.CardType || c.type || c.Type
                  return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
                }
                return false
              })
              
              if (forgebornInCards) {
                secondForgebornCard = forgebornInCards
                secondForgebornId = secondForgebornId || forgebornInCards.id || forgebornInCards.cardId || forgebornInCards.name
              }
            }
          }
        }
        
        // If we have secondForgebornId, try to find it
        if (secondForgebornId) {
          // First, try to find second forgeborn in normalizedCards
          let secondForgeborn = normalizedCards.find(card => 
            (card.id === secondForgebornId || 
             (card.id && secondForgebornId && card.id.includes(secondForgebornId)) ||
             (secondForgebornId && card.id && secondForgebornId.includes(card.id))) &&
            !isForgebornInList(card.id, forgebornCardsList)
          )
          
          // If not found in normalizedCards and we have secondForgebornCard, use it
          if (!secondForgeborn && secondForgebornCard) {
            const cardId = secondForgebornCard.id || secondForgebornCard.cardId || secondForgebornCard.name || secondForgebornId
            secondForgeborn = getCardInfo(cardId, secondForgebornCard)
          }
          
          // If still not found, try to find it in deck2.cards
          if (!secondForgeborn && deck2 && deck2.cards && Array.isArray(deck2.cards)) {
            const deck2Card = deck2.cards.find((c: any) => {
              if (typeof c === 'string') {
                return c === secondForgebornId
              } else if (typeof c === 'object' && c !== null) {
                const cId = c.id || c.cardId || c.name
                return cId === secondForgebornId || 
                       (cId && secondForgebornId && cId.includes(secondForgebornId)) ||
                       (secondForgebornId && cId && secondForgebornId.includes(cId))
              }
              return false
            })
            
            if (deck2Card) {
              const cardId = typeof deck2Card === 'string' ? deck2Card : (deck2Card.id || deck2Card.cardId || deck2Card.name)
              secondForgeborn = getCardInfo(cardId, typeof deck2Card === 'object' ? deck2Card : undefined)
            }
          }
          
          // If still not found, try to get forgeborn by cardType from deck2
          if (!secondForgeborn && deck2 && deck2.cards && Array.isArray(deck2.cards)) {
            const forgebornByTypeCard = deck2.cards.find((c: any) => {
              if (typeof c === 'object' && c !== null) {
                const cardType = c.cardType || c.CardType || c.type || c.Type
                return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
              }
              return false
            })
            
            if (forgebornByTypeCard && typeof forgebornByTypeCard === 'object') {
              const cardId = forgebornByTypeCard.id || forgebornByTypeCard.cardId || forgebornByTypeCard.name
              secondForgeborn = getCardInfo(cardId, forgebornByTypeCard)
            }
          }
          
          if (secondForgeborn) {
            addForgebornIfNotExists(secondForgeborn, secondForgebornId)
          }
        }
      }
      
      if (forgebornCardsList.length === 0) {
        const forgebornByType = normalizedCards.find(card =>
          card.type?.toLowerCase().includes('forgeborn') ||
          (card as any).cardType?.toLowerCase().includes('forgeborn')
        )
        if (forgebornByType) {
          addForgebornIfNotExists(forgebornByType)
        }
      }

      // Categorize remaining cards
      normalizedCards.forEach(card => {
        if (forgebornCardsList.includes(card)) return
        
        const cardData = card as any
        const cardTypeLower = (cardData.cardType || cardData.type || '').toLowerCase()
        // If this is actually a Forgeborn card but wasn't added yet, add and skip
        if (cardTypeLower.includes('forgeborn')) {
          addForgebornIfNotExists(card, card.id)
          return
        }

        const isSolbind = solbindCardIdsSet.has(card.id) ||
                         cardData.rarity === 'Solbind' || cardData.rarity === 'solbind' ||
                         card.type?.toLowerCase() === 'solbind' ||
                         cardData.cardType?.toLowerCase() === 'solbind'
        
        if (isSolbind) {
          solbindCardsList.push(card)
          return
        }

        // Check if spell - prioritize cardType from original card data
        // Get original card data to check cardType properly
        const originalCardForType = deckForUse && deckForUse.cards && Array.isArray(deckForUse.cards)
          ? deckForUse.cards.find((c: any, idx: number) => {
              if (typeof c === 'string') {
                return c === card.id
              }
              const cId = c?.id || c?.cardId || c?.name || `card-${idx}`
              return cId === card.id
            })
          : null
        
        const originalCardType = originalCardForType && typeof originalCardForType === 'object'
          ? (originalCardForType.cardType || originalCardForType.card_type || '')
          : ''
        const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
        
        // Determine if spell based ONLY on cardType
        // If cardType is "Spell", it's a spell, otherwise it's a creature (default)
        const lowerCardType = cardType.toLowerCase()
        const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
        
        if (isSpell) {
          spellCardsList.push(card)
        } else {
          creatureCardsList.push(card)
        }
      })

      // Also check forgeborn.solbindCards for second forgeborn (alternative forgeborn)
      if (deckForUse && deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.solbindCards && Array.isArray(deckForUse.forgeborn.solbindCards)) {
        deckForUse.forgeborn.solbindCards.forEach((solbindCard: any) => {
          if (solbindCard && solbindCard.id) {
            // Check if this is a Forgeborn card (alternative forgeborn, not a Solbind spell)
            // Try different ways to get cardType
            const cardType = solbindCard.cardType || solbindCard.CardType || solbindCard.type || solbindCard.Type
            const isForgebornCard = cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
            
            // Also check rarity - if it's NOT Solbind and has Forgeborn type, it's a second forgeborn
            const rarity = solbindCard.rarity || solbindCard.Rarity || ''
            const isNotSolbind = !rarity || (typeof rarity === 'string' && !rarity.toLowerCase().includes('solbind'))
            
            if (isForgebornCard && isNotSolbind) {
              // Check if this forgeborn is already in the list
              if (!isForgebornInList(solbindCard.id, forgebornCardsList)) {
                const secondForgeborn = getCardInfo(solbindCard.id, solbindCard)
                addForgebornIfNotExists(secondForgeborn, solbindCard.id)
                if (process.env.NODE_ENV === 'development') {
                  logWithTimestamp(`[DeckDetails] ✅ Added second forgeborn to image loading list: ${secondForgeborn.name} (${secondForgeborn.id})`)
                }
              }
            } else {
              // Only add if it's actually a Solbind card (rarity === 'Solbind')
              const isSolbindCard = solbindCard.rarity === 'Solbind' || solbindCard.rarity === 'solbind'
              if (isSolbindCard && !solbindCardsList.some(c => c.id === solbindCard.id)) {
                solbindCardsList.push(getCardInfo(solbindCard.id, solbindCard))
              }
            }
          }
        })
      }
      
      // Also add Solbind cards from solbindCards arrays in normalizedCards
      normalizedCards.forEach(card => {
        const cardData = card as any
        if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
          cardData.solbindCards.forEach((solbindCard: any) => {
            if (solbindCard && solbindCard.id) {
              if (!solbindCardsList.some(c => c.id === solbindCard.id)) {
                solbindCardsList.push(getCardInfo(solbindCard.id, solbindCard))
              }
            }
          })
        }
      })

      // Remove Solbinds from spells list if any slipped through (e.g., missing rarity/type data)
      if (spellCardsList.length > 0) {
        const solbindIds = new Set(solbindCardsList.map(sb => sb.id).filter(Boolean))
        const cleanedSpells: CardInfo[] = []
        spellCardsList.forEach(card => {
          const cardData = card as any
      const isParentSolbind =
        (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
        !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)
          const isSolbindById = !isParentSolbind && solbindIds.has(card.id)
          const isSolbindByRarity =
            !isParentSolbind &&
            typeof cardData.rarity === 'string' &&
            cardData.rarity.toLowerCase().includes('solbind')
          if (isSolbindById || isSolbindByRarity) {
            // Ensure it is listed in solbind cards
            if (!solbindCardsList.some(sb => sb.id === card.id)) {
              solbindCardsList.push(card)
              solbindIds.add(card.id || '')
            }
            return
          }
          cleanedSpells.push(card)
        })
        // Replace list with cleaned version
        spellCardsList.length = 0
        cleanedSpells.forEach(c => spellCardsList.push(c))
      }

      logWithTimestamp(`[DeckDetails] 📋 Image loading order: Forgeborn(${forgebornCardsList.length}) -> Creatures(${creatureCardsList.length})/Spells(${spellCardsList.length}) L1 -> L2 -> L3 -> Solbind(${solbindCardsList.length})`)

      // 1. Load Forgeborn first
      for (const card of forgebornCardsList) {
        if (!isModalOpen) {
          logWithTimestamp(`[DeckDetails] ⏹️ Stopping Forgeborn loading - modal closed`)
          break
        }
        
        if (cardImages[card.id] && Object.keys(cardImages[card.id]).length > 0) {
          logWithTimestamp(`[DeckDetails] Skipping Forgeborn ${card.id} - already loaded`)
          continue
        }

        logWithTimestamp(`[DeckDetails] 🔥 [1/5] Loading Forgeborn: ${card.id} (${card.name})`)
        const imageUrl = await loadSingleImage(card.id, 1, true)
        
        if (process.env.NODE_ENV === 'development') {
          if (imageUrl) {
            logWithTimestamp(`[DeckDetails] ✅ Forgeborn image loaded: ${card.name} (${card.id}) -> ${imageUrl}`)
          } else {
            console.warn(`[DeckDetails] ⚠️ Forgeborn image failed to load: ${card.name} (${card.id})`)
          }
        }
        
        if (!isModalOpen) {
          logWithTimestamp(`[DeckDetails] ⏹️ Stopping after Forgeborn load - modal closed`)
          break
        }
        
        if (imageUrl) {
          // Update state immediately for all three levels
          updateImageState(card.id, 1, imageUrl)
          updateImageState(card.id, 2, imageUrl)
          updateImageState(card.id, 3, imageUrl)
          logWithTimestamp(`[DeckDetails] ✅ Forgeborn loaded: ${card.id}`)
        } else {
          errors.add(card.id)
          console.warn(`[DeckDetails] ⚠️ Forgeborn failed: ${card.id}`)
        }
      }

      // 2-4. Load Creatures and Spells by level (all level 1 first, then all level 2, then all level 3)
      const regularCards = [...creatureCardsList, ...spellCardsList]
      
      for (let level = 1; level <= 3; level++) {
        if (!isModalOpen) {
          logWithTimestamp(`[DeckDetails] ⏹️ Stopping Creatures/Spells loading at level ${level} - modal closed`)
          break
        }
        
        logWithTimestamp(`[DeckDetails] 📦 [${level + 1}/5] Loading all Creatures/Spells Level ${level} in parallel (10 threads)...`)
        
        // Prepare tasks for this level (skip already loaded)
        const tasks = regularCards
          .filter(card => !(cardImages[card.id] && cardImages[card.id][level]))
          .map(card => ({
            cardId: card.id,
            level: level,
            isForgeborn: false,
            cardName: card.name
          }))
        
        if (tasks.length > 0) {
          await loadImagesInParallel(
            tasks,
            10, // 10 parallel threads
            (cardId, level, imageUrl) => {
              if (imageUrl) {
                updateImageState(cardId, level, imageUrl)
                const task = tasks.find(t => t.cardId === cardId)
                logWithTimestamp(`[DeckDetails] ✅ Level ${level} loaded: ${cardId} (${task?.cardName || 'unknown'})`)
              }
            },
            () => !isModalOpen
          )
        }
      }

      // 5. Load Solbind last
      if (!isModalOpen) {
        logWithTimestamp(`[DeckDetails] ⏹️ Skipping Solbind loading - modal closed`)
        return
      }
      
      logWithTimestamp(`[DeckDetails] 🔷 [5/5] Loading Solbind cards in parallel (10 threads)...`)
      
      // Prepare tasks for Solbind cards (all levels for each card)
      const solbindTasks: Array<{ cardId: string; level: number; isForgeborn: boolean; cardName: string }> = []
      
      for (const card of solbindCardsList) {
        if (cardImages[card.id] && Object.keys(cardImages[card.id]).length > 0) {
          logWithTimestamp(`[DeckDetails] Skipping Solbind ${card.id} - already loaded`)
          continue
        }
        
        // Add tasks for all three levels
        for (let level = 1; level <= 3; level++) {
          solbindTasks.push({
            cardId: card.id,
            level: level,
            isForgeborn: false,
            cardName: card.name
          })
        }
      }
      
      if (solbindTasks.length > 0) {
        const loadedLevels = new Map<string, Set<number>>()
        
        await loadImagesInParallel(
          solbindTasks,
          10, // 10 parallel threads
          (cardId, level, imageUrl) => {
            if (imageUrl) {
              updateImageState(cardId, level, imageUrl)
              if (!loadedLevels.has(cardId)) {
                loadedLevels.set(cardId, new Set())
              }
              loadedLevels.get(cardId)!.add(level)
            }
          },
          () => !isModalOpen
        )
        
        // Log results for each Solbind card
        for (const card of solbindCardsList) {
          const loaded = loadedLevels.get(card.id)
          if (loaded && loaded.size > 0) {
            logWithTimestamp(`[DeckDetails] ✅ Solbind loaded: ${card.id} (${card.name}) - ${loaded.size} levels`)
          } else if (!cardImages[card.id] || Object.keys(cardImages[card.id]).length === 0) {
            errors.add(card.id)
            console.warn(`[DeckDetails] ⚠️ Solbind failed: ${card.id}`)
          }
        }
      }

      if (errors.size > 0 && isModalOpen) {
        setImageErrors(prev => new Set([...prev, ...errors]))
      }
    }

    loadImages()
    
    // Cleanup: mark modal as closed when it closes or component unmounts
    return () => {
      isModalOpen = false
    }
  }, [opened, normalizedCards.length, deck?.id, solbindCardIdsKey, getFusedDeckSourceDecks, deck]) */ // DISABLED - end of old preload useEffect

  // Group cards by categories - must be before any conditional returns
  const forgebornCards: CardInfo[] = useMemo(() => {
    const deckForUse = activeFullDeckData || deck
    if (!deckForUse) return []
    
    const forgebornList: CardInfo[] = []

    const normalizeForgebornKey = (id?: string, name?: string): string => {
      const lowerId = (id || '').toLowerCase()
      const lowerName = (name || '').toLowerCase()
      const keyFromName = KNOWN_FORGEBORN_NAMES.find(n => lowerName.includes(n))
      const keyFromId = KNOWN_FORGEBORN_NAMES.find(n => lowerId.includes(n))
      if (keyFromName) return keyFromName
      if (keyFromId) return keyFromId
      return lowerId ? lowerId.replace(/[^a-z]/g, '') : ''
    }
    
    const findForgebornDetails = (id?: string): any | null => {
      if (!id) return null
      const decksToSearch = [deckForUse, ...(deckForUse?.format === 'Fused' ? getFusedDeckSourceDecks.filter(Boolean) : [])]
      for (const d of decksToSearch) {
        const dAny = d as any
        if (dAny?.forgeborn && (dAny.forgeborn.id === id || dAny.forgebornId === id || (dAny.forgeborn.id && id.includes(dAny.forgeborn.id)))) {
          return dAny.forgeborn
        }
      }
      return null
    }
    
    // Helper function to check if a forgeborn is already in the list
    // Handles different ID variants (e.g., s2nn1cercee324 vs s2nn1cercee431)
    const isForgebornInList = (
      forgebornId: string,
      forgebornList: CardInfo[],
      forgebornName?: string
    ): boolean => {
      if (!forgebornId) return false
      const targetKey = normalizeForgebornKey(forgebornId, forgebornName)
      return forgebornList.some(fb => {
        if (!fb.id) return false
        // Exact match
        if (fb.id === forgebornId) return true
        const fbKey = normalizeForgebornKey(fb.id, fb.name)
        if (targetKey && fbKey && targetKey === fbKey) return true
        // Partial match
        return (fb.id.includes(forgebornId) || forgebornId.includes(fb.id))
      })
    }

    // Helper function to add forgeborn to list if not already present
    const addForgebornIfNotExists = (forgeborn: CardInfo | null, forgebornId?: string): void => {
      if (!forgeborn) return
      const idToCheck = forgebornId || forgeborn.id
      if (!idToCheck) return
      if (!isForgebornInList(idToCheck, forgebornList, forgeborn.name)) {
        const apiDetails = findForgebornDetails(idToCheck)
        const mergedCard: CardInfo = {
          ...apiDetails,
          ...forgeborn,
          id: forgeborn.id || apiDetails?.id || idToCheck,
          cardType: apiDetails?.cardType || (forgeborn as any).cardType || 'Forgeborn',
          type: apiDetails?.type || (forgeborn as any).type || apiDetails?.cardType || 'Forgeborn',
          name: forgeborn.name || apiDetails?.name || apiDetails?.title,
        } as CardInfo
        forgebornList.push(mergedCard)
      }
    }
    
    // First, try to find Forgeborn by forgebornId (most reliable)
    if (deckForUse.forgebornId) {
      const forgeborn = normalizedCards.find(card => 
        card.id === deckForUse.forgebornId || 
        (card.id && deckForUse.forgebornId && card.id.includes(deckForUse.forgebornId)) ||
        (deckForUse.forgebornId && card.id && deckForUse.forgebornId.includes(card.id))
      )
      if (forgeborn) {
        addForgebornIfNotExists(forgeborn, deckForUse.forgebornId)
      } else if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
        // If forgeborn not found in normalizedCards, try to get it from deckForUse.forgeborn object
        const forgebornId = deckForUse.forgeborn.id || deckForUse.forgebornId
        const forgebornFromObject = getCardInfo(forgebornId, deckForUse.forgeborn)
        addForgebornIfNotExists(forgebornFromObject, forgebornId)
      }
    } else if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
      // If no forgebornId but we have forgeborn object, use it
      const forgebornFromObject = getCardInfo(deckForUse.forgeborn.id, deckForUse.forgeborn)
      addForgebornIfNotExists(forgebornFromObject, deckForUse.forgeborn.id)
    }
    
    // For fused decks, ensure first forgeborn is found from first source deck
    // This is important because first forgeborn might not be in normalizedCards
    if (deckForUse.format === 'Fused') {
      const [deck1, deck2] = getFusedDeckSourceDecks
      const fusedDeckAny = deckForUse as any

      const tryAddDeckForgeborn = (sourceDeck: any) => {
        if (!sourceDeck) return
        const id = sourceDeck.forgebornId || sourceDeck.forgeborn?.id
        if (!id) return
        let fbCard = normalizedCards.find(card =>
          card.id === id ||
          (card.id && id && card.id.includes(id)) ||
          (id && card.id && id.includes(card.id))
        )
        if (!fbCard && sourceDeck.forgeborn) {
          fbCard = getCardInfo(id, sourceDeck.forgeborn)
        }
        if (fbCard) {
          addForgebornIfNotExists(fbCard, id)
        }
      }

      // Always try to add both source forgeborn cards, regardless of currentForgebornId
      tryAddDeckForgeborn(deck1)
      tryAddDeckForgeborn(deck2)
      
      // Try to get first forgeborn from deck1
      let firstForgebornId: string | undefined
      let firstForgebornCard: any = null
      
      // First, try to get forgebornId from deckForUse or fusedDeckAny
      firstForgebornId = deckForUse.forgebornId || (deck1 && (deck1 as any).forgebornId)
      
      // Also check myDecks directly if deck1 doesn't have full data
      if (!firstForgebornId && fusedDeckAny.myDecks && Array.isArray(fusedDeckAny.myDecks) && fusedDeckAny.myDecks.length >= 1) {
        const myDeck1 = fusedDeckAny.myDecks[0]
        if (myDeck1 && typeof myDeck1 === 'object') {
          firstForgebornId = myDeck1.forgebornId || myDeck1.forgeborn?.id || fusedDeckAny.currentForgebornId
          
          // Also check if forgeborn is in the cards array
          if (myDeck1.cards && typeof myDeck1.cards === 'object') {
            // cards might be an object with numeric keys
            const cardsArray = Array.isArray(myDeck1.cards) 
              ? myDeck1.cards 
              : Object.values(myDeck1.cards)
            
            const forgebornInCards = cardsArray.find((c: any) => {
              if (typeof c === 'object' && c !== null) {
                const cardType = c.cardType || c.CardType || c.type || c.Type
                return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
              }
              return false
            })
            
            if (forgebornInCards) {
              firstForgebornCard = forgebornInCards
              firstForgebornId = firstForgebornId || forgebornInCards.id || forgebornInCards.cardId || forgebornInCards.name
            }
          }
        }
      }
      
      // If we have firstForgebornId, try to find it
      // Check if first forgeborn is already in the list
      const firstForgebornAlreadyInList = firstForgebornId && isForgebornInList(firstForgebornId, forgebornList)
      
      if (firstForgebornId && !firstForgebornAlreadyInList) {
        // First, try to find first forgeborn in normalizedCards
        let firstForgeborn = normalizedCards.find(card => 
          card.id === firstForgebornId || 
          (card.id && firstForgebornId && card.id.includes(firstForgebornId)) ||
          (firstForgebornId && card.id && firstForgebornId.includes(card.id))
        )
        
        // If not found in normalizedCards and we have firstForgebornCard, use it
        if (!firstForgeborn && firstForgebornCard) {
          const cardId = firstForgebornCard.id || firstForgebornCard.cardId || firstForgebornCard.name || firstForgebornId
          firstForgeborn = getCardInfo(cardId, firstForgebornCard)
        }
        
        // If still not found, try to find it in deck1.cards
        if (!firstForgeborn && deck1 && deck1.cards && Array.isArray(deck1.cards)) {
          const deck1Card = deck1.cards.find((c: any) => {
            if (typeof c === 'string') {
              return c === firstForgebornId
            } else if (typeof c === 'object' && c !== null) {
              const cId = c.id || c.cardId || c.name
              return cId === firstForgebornId || 
                     (cId && firstForgebornId && cId.includes(firstForgebornId)) ||
                     (firstForgebornId && cId && firstForgebornId.includes(cId))
            }
            return false
          })
          
          if (deck1Card) {
            const cardId = typeof deck1Card === 'string' ? deck1Card : (deck1Card.id || deck1Card.cardId || deck1Card.name)
            firstForgeborn = getCardInfo(cardId, typeof deck1Card === 'object' ? deck1Card : undefined)
          }
        }
        
        // If still not found, try to get forgeborn by cardType from deck1
        if (!firstForgeborn && deck1 && deck1.cards && Array.isArray(deck1.cards)) {
          const forgebornByTypeCard = deck1.cards.find((c: any) => {
            if (typeof c === 'object' && c !== null) {
              const cardType = c.cardType || c.CardType || c.type || c.Type
              return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
            }
            return false
          })
          
          if (forgebornByTypeCard && typeof forgebornByTypeCard === 'object') {
            const cardId = forgebornByTypeCard.id || forgebornByTypeCard.cardId || forgebornByTypeCard.name
            firstForgeborn = getCardInfo(cardId, forgebornByTypeCard)
          }
        }
        
        if (firstForgeborn) {
          addForgebornIfNotExists(firstForgeborn, firstForgebornId)
        }
      }
    }
    
    // For fused decks, add second forgeborn from the second source deck
    if (deckForUse.format === 'Fused') {
      const [deck1, deck2] = getFusedDeckSourceDecks
      const fusedDeckAny = deckForUse as any
      
      // Try to get second forgeborn from deck2
      let secondForgebornId: string | undefined
      let secondForgebornCard: any = null
      
      // First, try to get forgebornId from deck2
      if (deck2 && (deck2 as any).forgebornId) {
        secondForgebornId = (deck2 as any).forgebornId
      }
      
      // Also check myDecks directly if deck2 doesn't have full data
      if (!secondForgebornId && fusedDeckAny.myDecks && Array.isArray(fusedDeckAny.myDecks) && fusedDeckAny.myDecks.length >= 2) {
        const myDeck2 = fusedDeckAny.myDecks[1]
        if (myDeck2 && typeof myDeck2 === 'object') {
          secondForgebornId = myDeck2.forgebornId || myDeck2.forgeborn?.id
          
          // Also check if forgeborn is in the cards array
          if (myDeck2.cards && typeof myDeck2.cards === 'object') {
            // cards might be an object with numeric keys
            const cardsArray = Array.isArray(myDeck2.cards) 
              ? myDeck2.cards 
              : Object.values(myDeck2.cards)
            
            const forgebornInCards = cardsArray.find((c: any) => {
              if (typeof c === 'object' && c !== null) {
                const cardType = c.cardType || c.CardType || c.type || c.Type
                return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
              }
              return false
            })
            
            if (forgebornInCards) {
              secondForgebornCard = forgebornInCards
              secondForgebornId = secondForgebornId || forgebornInCards.id || forgebornInCards.cardId || forgebornInCards.name
            }
          }
        }
      }
      
      // If we have secondForgebornId, try to find it
      if (secondForgebornId) {
          // First, try to find second forgeborn in normalizedCards
          let secondForgeborn = normalizedCards.find(card => 
            (card.id === secondForgebornId || 
             (card.id && secondForgebornId && card.id.includes(secondForgebornId)) ||
             (secondForgebornId && card.id && secondForgebornId.includes(card.id))) &&
            !isForgebornInList(card.id, forgebornList)
          )
        
        // If not found in normalizedCards and we have secondForgebornCard, use it
        if (!secondForgeborn && secondForgebornCard) {
          const cardId = secondForgebornCard.id || secondForgebornCard.cardId || secondForgebornCard.name || secondForgebornId
          secondForgeborn = getCardInfo(cardId, secondForgebornCard)
        }
        
        // If still not found, try to find it in deck2.cards
        if (!secondForgeborn && deck2 && deck2.cards && Array.isArray(deck2.cards)) {
          const deck2Card = deck2.cards.find((c: any) => {
            if (typeof c === 'string') {
              return c === secondForgebornId
            } else if (typeof c === 'object' && c !== null) {
              const cId = c.id || c.cardId || c.name
              return cId === secondForgebornId || 
                     (cId && secondForgebornId && cId.includes(secondForgebornId)) ||
                     (secondForgebornId && cId && secondForgebornId.includes(cId))
            }
            return false
          })
          
          if (deck2Card) {
            const cardId = typeof deck2Card === 'string' ? deck2Card : (deck2Card.id || deck2Card.cardId || deck2Card.name)
            secondForgeborn = getCardInfo(cardId, typeof deck2Card === 'object' ? deck2Card : undefined)
          }
        }
        
        // If still not found, try to get forgeborn by cardType from deck2
        if (!secondForgeborn && deck2 && deck2.cards && Array.isArray(deck2.cards)) {
          const forgebornByTypeCard = deck2.cards.find((c: any) => {
            if (typeof c === 'object' && c !== null) {
              const cardType = c.cardType || c.CardType || c.type || c.Type
              return cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
            }
            return false
          })
          
          if (forgebornByTypeCard && typeof forgebornByTypeCard === 'object') {
            const cardId = forgebornByTypeCard.id || forgebornByTypeCard.cardId || forgebornByTypeCard.name
            secondForgeborn = getCardInfo(cardId, forgebornByTypeCard)
          }
        }
        
        if (secondForgeborn) {
          addForgebornIfNotExists(secondForgeborn, secondForgebornId)
        }
      }
    }
    
    // Check forgeborn.solbindCards for second forgeborn (alternative forgeborn)
    if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object') {
      if (process.env.NODE_ENV === 'development') {
        // logWithTimestamp('[DeckDetails] Forgeborn object:', deckForUse.forgeborn)
        // logWithTimestamp('[DeckDetails] Forgeborn solbindCards:', deckForUse.forgeborn.solbindCards)
      }
      
      if (deckForUse.forgeborn.solbindCards && Array.isArray(deckForUse.forgeborn.solbindCards)) {
        deckForUse.forgeborn.solbindCards.forEach((solbindCard: any) => {
          if (solbindCard && solbindCard.id) {
            // Check if this is a Forgeborn card (alternative forgeborn, not a Solbind spell)
            // Try different ways to get cardType
            const cardType = solbindCard.cardType || solbindCard.CardType || solbindCard.type || solbindCard.Type
            const nameLower = (solbindCard.name || solbindCard.title || '').toLowerCase()
            const isForgebornCard =
              (cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')) ||
              KNOWN_FORGEBORN_NAMES.some(n => nameLower.includes(n))
            
            if (process.env.NODE_ENV === 'development') {
              // Debug logging disabled for performance
              // logWithTimestamp(`[DeckDetails] Checking solbindCard...`)
            }
            
            if (isForgebornCard) {
              // Check if this forgeborn is already in the list
              if (!isForgebornInList(solbindCard.id, forgebornList)) {
                const secondForgeborn = getCardInfo(solbindCard.id, solbindCard)
                addForgebornIfNotExists(secondForgeborn, solbindCard.id)
                if (process.env.NODE_ENV === 'development') {
                  logWithTimestamp(`[DeckDetails] ✅ Added second forgeborn: ${secondForgeborn.name} (${secondForgeborn.id})`)
                }
              }
            }
          }
        })
      }
    }
    
    // If we found forgeborn(s), return them
    if (forgebornList.length > 0) {
      return forgebornList
    }
    
    // Fallback: find by cardType
    const forgebornByType = normalizedCards.find(card =>
      card.type?.toLowerCase().includes('forgeborn') ||
      (card as any).cardType?.toLowerCase().includes('forgeborn')
    )
    if (forgebornByType) {
      addForgebornIfNotExists(forgebornByType, forgebornByType.id)
    }

    // Final safety: include any cards that look like Forgeborn by name/type (e.g., Solbind-alt Forgeborn)
    uniqueNormalizedCards.forEach(card => {
      const cardData = card as any
      const nameLower = (cardData.name || cardData.title || '').toLowerCase()
      const typeLower = (cardData.cardType || cardData.type || '').toLowerCase()
      const idLower = (cardData.id || cardData.cardId || '').toLowerCase()
      const matchesKnown = KNOWN_FORGEBORN_NAMES.some(n => nameLower.includes(n) || idLower.includes(n))
      const looksForgeborn = typeLower.includes('forgeborn') || matchesKnown
      if (looksForgeborn) {
        addForgebornIfNotExists(card, card.id || card.cardId || card.name)
      }
    })
    
    return forgebornList
  }, [normalizedCards, deck, activeFullDeckData, getFusedDeckSourceDecks])

  const solbindCards: CardInfo[] = useMemo(() => {
    const deckForUse = activeFullDeckData || deck
    if (!deckForUse) return []

    const solbindCardObjects: CardInfo[] = []
    const parentSolbindIds = new Set<string>()
    const parseSolbindString = (value?: string | null): string[] => {
      if (!value || typeof value !== 'string') return []
      return value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    }

    const addSolbindFromForgeborn = (source: any) => {
      const fb = source?.forgeborn
      if (!fb || typeof fb !== 'object') return

      if (Array.isArray(fb.solbindCards)) {
        fb.solbindCards.forEach((solbindCard: any) => {
          if (solbindCard && solbindCard.id && !solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
            solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
          }
        })
      }

      ;[fb.solbindId1 || fb.solbindid1, fb.solbindId2 || fb.solbindid2].forEach(id => {
        if (id && !solbindCardObjects.some(sb => sb.id === id)) {
          solbindCardObjects.push(getCardInfo(id))
        }
      })
    }

    addSolbindFromForgeborn(deckForUse)

    if (isFusedDeckLike(deckForUse)) {
      const seen = new Set<string>()
      const candidates: any[] = []
      const pushCandidate = (candidate: any) => {
        if (!candidate) return
        const key = candidate.id || candidate.deckId || candidate.name
        if (key) {
          const keyStr = String(key)
          if (seen.has(keyStr)) return
          seen.add(keyStr)
        }
        candidates.push(candidate)
      }

      if (Array.isArray((deckForUse as any).myDecks)) {
        (deckForUse as any).myDecks.forEach((candidate: any) => pushCandidate(candidate))
      }
      if (Array.isArray((deck as any)?.myDecks)) {
        (deck as any).myDecks.forEach((candidate: any) => pushCandidate(candidate))
      }
      getFusedDeckSourceDecks.forEach((candidate) => pushCandidate(candidate))
      fusedSourceDecks.forEach((candidate) => pushCandidate(candidate))
      Object.values(halfDetails).forEach((candidate) => pushCandidate(candidate))

      candidates.forEach(addSolbindFromForgeborn)
    }

    // Cards with solbindCards arrays
    uniqueNormalizedCards.forEach(card => {
      const cardData = card as any
      const solbindList =
        Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0
          ? cardData.solbindCards
          : (() => {
              const fallbackInfo = getCardInfo(card.id || cardData.cardId || cardData.name)
              const list = (fallbackInfo as any)?.solbindCards
              return Array.isArray(list) ? list : []
            })()
      const solbindStringIds = parseSolbindString(cardData.solbind)

      const hasSolbindChildren =
        solbindList.length > 0 ||
        solbindStringIds.length > 0 ||
        !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)

      if (hasSolbindChildren && card.id) parentSolbindIds.add(card.id)

      solbindList.forEach((solbindCard: any) => {
        if (solbindCard && solbindCard.id && !solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
          solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
        }
      })
      solbindStringIds.forEach(id => {
        if (id && !solbindCardObjects.some(sb => sb.id === id)) {
          solbindCardObjects.push(getCardInfo(id))
        }
      })

      const id1 = cardData.solbindId1 || cardData.solbindid1
      const id2 = cardData.solbindId2 || cardData.solbindid2
      ;[id1, id2].forEach(id => {
        if (id && !solbindCardObjects.some(sb => sb.id === id)) {
          solbindCardObjects.push(getCardInfo(id))
        }
      })
    })

    // Solbind rarity cards (non-parent)
    uniqueNormalizedCards.forEach(card => {
      if (forgebornCards.includes(card)) return
      const cardData = card as any
      const cardId = card.id
      const hasSolbindChildren =
        (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
        !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)
      if (hasSolbindChildren) return
      if (solbindCardIdsSet.has(cardId)) {
        if (!solbindCardObjects.some(sb => sb.id === cardId)) {
          solbindCardObjects.push(card)
        }
        return
      }
      if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
        if (!solbindCardObjects.some(sb => sb.id === cardId)) {
          solbindCardObjects.push(card)
        }
      }
    })

    // Fallback: ensure all known Solbind IDs are represented
    const existingIds = new Set(solbindCardObjects.map(sb => sb.id).filter(Boolean) as string[])
    solbindCardIdsSet.forEach(id => {
      if (!id) return
      if (parentSolbindIds.has(id)) return
      if (!existingIds.has(id)) {
        solbindCardObjects.push(getCardInfo(id))
        existingIds.add(id)
      }
    })

    const dedupMap = new Map<string, CardInfo>()
    solbindCardObjects.forEach((sb, idx) => {
      const key = sb.id || sb.cardId || sb.name || `solbind-${idx}`
      if (!dedupMap.has(key)) {
        dedupMap.set(key, { ...sb, id: sb.id || key })
      }
    })

    return Array.from(dedupMap.values())
  }, [uniqueNormalizedCards, forgebornCards, solbindCardIdsSet, deck, activeFullDeckData, getFusedDeckSourceDecks, fusedSourceDecks, halfDetails])

  // Merge rarity summary with Solbind count (make sure Solbind shows up if we have Solbind cards)
  const displayRaritySummary = useMemo(() => {
    const summary = new Map(raritySummary)
    // Safety net: ensure Solbind appears at least once if we have any solbind cards
    if (!summary.has('Solbind') && solbindCards.length > 0) {
      summary.set('Solbind', 1)
    }
    return summary
  }, [raritySummary, solbindCards, solbindCardIdsSet])

  // Track last deck ID to detect deck changes
  const lastDeckIdRef = useRef<string | null>(null)
  const lastForgebornCardsLengthRef = useRef<number>(0)
  
  // Reset selected card when deck changes
  useEffect(() => {
    const currentDeckId = deck?.id || null
    const prevDeckId = lastDeckIdRef.current

    if (currentDeckId && prevDeckId !== currentDeckId) {
      lastDeckIdRef.current = currentDeckId
      lastForgebornCardsLengthRef.current = 0
      setSelectedCard(null)
      setSelectedLevel(1)
    }
  }, [deck?.id]) // Reset when deck changes


  // Select the first card by default when deck changes or modal opens
  // Prefer Forgeborn if available, otherwise select the first card
  useEffect(() => {
    const hasCards = normalizedCards.length > 0
    const hasForgeborn = forgebornCards.length > 0
    const normalizedIds = new Set(normalizedCards.map(c => c.id).filter(Boolean))
    const forgebornIds = new Set(forgebornCards.map(c => c.id).filter(Boolean))
    const solbindIds = new Set(solbindCards.map(c => c.id).filter(Boolean))
    if (opened && (hasCards || hasForgeborn)) {
      const deckChanged = lastDeckIdRef.current !== deck?.id
      const forgebornBecameAvailable = forgebornCards.length > 0 && lastForgebornCardsLengthRef.current === 0
      const selectedCardIsFromDeck = selectedCard 
        ? (
            normalizedIds.has(selectedCard.id || '') ||
            forgebornIds.has(selectedCard.id || '') ||
            solbindIds.has(selectedCard.id || '')
          )
        : false
      
      // Update ref for forgeborn cards length
      if (forgebornCards.length > 0) {
        lastForgebornCardsLengthRef.current = forgebornCards.length
      }
      
      // If no card is selected, or deck changed, or forgeborn became available
      if (!selectedCard || deckChanged || !selectedCardIsFromDeck) {
        // No remembered selection, pick defaults
        if (forgebornCards.length > 0) {
          handleSelectCard(forgebornCards[0])
        } else {
          handleSelectCard(normalizedCards[0])
        }
      } else if (forgebornBecameAvailable && selectedCard) {
        // If forgeborn became available and current card is not forgeborn, select forgeborn
        const isCurrentCardForgeborn = forgebornCards.some(fb => fb.id === selectedCard.id)
        if (!isCurrentCardForgeborn) {
          handleSelectCard(forgebornCards[0])
        }
      }
    }
  }, [opened, normalizedCards, deck?.id, forgebornCards, solbindCards, selectedCard, handleSelectCard]) // Only depend on stable values

  // Reset level when card changes (but preserve if user selected a different level)
  useEffect(() => {
    if (selectedCard) {
      // Only reset level if card actually changed (not just on image load)
      if (lastSelectedCardIdRef.current !== selectedCard.id) {
        lastSelectedCardIdRef.current = selectedCard.id
        levelManuallyChangedRef.current = false
        
        // For Solbind cards, find the first available level
        // For other cards, start with level 1
        if (solbindCardIdsSet.has(selectedCard.id) || (selectedCard as any).rarity === 'Solbind' || (selectedCard as any).rarity === 'solbind') {
          const cardImageData = cardImages[selectedCard.id]
          if (cardImageData) {
            const availableLevels = Object.keys(cardImageData).map(Number).sort()
            if (availableLevels.length > 0) {
              setSelectedLevel(availableLevels[0])
            } else {
              // If no images loaded yet, wait for them to load
              setSelectedLevel(1)
            }
          } else {
            // If no images loaded yet, wait for them to load
            setSelectedLevel(1)
          }
        } else {
          // For all non-solbind cards, start with level 1 (user can change it with level selector)
          setSelectedLevel(1)
        }
      }
      // If card didn't change but images loaded, don't reset level
      // (this prevents level from resetting when images finish loading)
    }
  }, [selectedCard, cardImages, solbindCardIdsSet]) // Only depend on card selection and loaded images

  // Ensure the first Forgeborn image loads immediately when modal opens
  useEffect(() => {
    if (!opened || forgebornCards.length === 0) return
    const firstForgeborn = forgebornCards[0]
    if (!firstForgeborn?.id) return

    const alreadyLoaded = cardImages[firstForgeborn.id]?.[1]
    if (alreadyLoaded) return

    let isCanceled = false
    markLevelsLoading(firstForgeborn.id, [1, 2, 3])
    startInFlight(firstForgeborn.id, 1)

    loadImageOnce(firstForgeborn.id, 1, true)
      .then((imageUrl) => {
        if (isCanceled) return
        if (imageUrl) {
          setCardImages(prev => ({
            ...prev,
            [firstForgeborn.id]: { 1: imageUrl, 2: imageUrl, 3: imageUrl }
          }))
          markImageReady(firstForgeborn.id, 1, imageUrl)
          markImageReady(firstForgeborn.id, 2, imageUrl)
          markImageReady(firstForgeborn.id, 3, imageUrl)
        }
      })
      .finally(() => {
        if (!isCanceled) {
          markLevelDone(firstForgeborn.id, 1)
          markLevelDone(firstForgeborn.id, 2)
          markLevelDone(firstForgeborn.id, 3)
        }
        finishInFlight(firstForgeborn.id, 1)
      })

    return () => {
      isCanceled = true
    }
  }, [opened, forgebornCards, cardImages, markLevelsLoading, markLevelDone, isInFlight, startInFlight, finishInFlight, loadImageOnce])
  
  // If a load was canceled, ensure in-flight flags are cleared to allow retries
  useEffect(() => {
    const inFlightRef = loadingInFlightRef
    return () => {
      inFlightRef.current.clear()
    }
  }, [])
  
  // Auto-select first available level for Solbind cards when images load
  useEffect(() => {
    if (!selectedCard) return
    
    const isSolbind = solbindCardIdsSet.has(selectedCard.id) ||
                      (selectedCard as any).rarity === 'Solbind' ||
                      (selectedCard as any).rarity === 'solbind'
    
    if (!isSolbind) return // Only auto-select for Solbind cards
    
    const cardImageData = cardImages[selectedCard.id]
    if (!cardImageData) return // Wait for images to load
    
    // Find first available level
    const availableLevels = Object.keys(cardImageData).map(Number).sort()
    if (availableLevels.length === 0) return // No levels available
    
    const firstAvailableLevel = availableLevels[0]
    
    // Check if current selected level exists
    const currentLevelExists = cardImageData[selectedLevel] !== undefined
    
    // If current level doesn't exist, switch to first available
    if (!currentLevelExists && !levelManuallyChangedRef.current) {
      if (process.env.NODE_ENV === 'development') {
        // logWithTimestamp(`[DeckDetails] Auto-selecting first available level...`)
      }
      setSelectedLevel(firstAvailableLevel)
    }
  }, [selectedCard, cardImages, selectedLevel, solbindCardIdsSet])
  
  // Handler for level button click - mark as manually changed
  const handleLevelChange = (level: number) => {
    levelManuallyChangedRef.current = true
    setSelectedLevel(level)
  }
  
  // Mouse slider functionality for switching levels - divide image into 3 vertical zones
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    // Only enable slider for creatures and spells (not Forgeborn)
    if (!selectedCard) return
    
    const isForgeborn = deck?.forgebornId === selectedCard.id || 
                       selectedCard.id === deck?.forgebornId ||
                       (selectedCard.id && deck?.forgebornId && selectedCard.id.includes(deck.forgebornId)) ||
                       (deck?.forgebornId && selectedCard.id && deck.forgebornId.includes(selectedCard.id)) ||
                       selectedCard.type?.toLowerCase().includes('forgeborn') ||
                       (selectedCard as any).cardType?.toLowerCase().includes('forgeborn')
    
    const selectedCardData = selectedCard as any
    const isSolbind = solbindCardIdsSet.has(selectedCard.id) ||
                     selectedCardData.rarity === 'Solbind' || selectedCardData.rarity === 'solbind' ||
                     selectedCard.type?.toLowerCase() === 'solbind' ||
                     selectedCardData.cardType?.toLowerCase() === 'solbind'
    
    // Skip slider for Forgeborn (they don't have levels)
    if (isForgeborn) return
    
    // Get the image element and its bounding rectangle
    const imageElement = e.currentTarget
    const rect = imageElement.getBoundingClientRect()
    const imageWidth = rect.width
    
    // Get mouse position relative to the left edge of the image
    const mouseX = e.clientX - rect.left
    
    // Divide image into 3 equal vertical zones
    const zoneWidth = imageWidth / 3
    
    // Determine which zone the mouse is in and set corresponding level
    let newLevel: number
    if (mouseX < zoneWidth) {
      // First third (0 to 1/3) -> Level 1
      newLevel = 1
    } else if (mouseX < zoneWidth * 2) {
      // Second third (1/3 to 2/3) -> Level 2
      newLevel = 2
    } else {
      // Third third (2/3 to 1) -> Level 3
      newLevel = 3
    }
    
    // Update level if it changed
    if (newLevel !== selectedLevel) {
      levelManuallyChangedRef.current = true
      setSelectedLevel(newLevel)
    }
  }, [selectedCard, deck, selectedLevel, solbindCardIdsSet])
  
  const handleMouseLeave = useCallback(() => {
    // Optional: could reset to level 1 when mouse leaves, but keeping current level for now
  }, [])

  const renderSelectedCardFrame = useCallback((compact: boolean) => {
    if (!selectedCard) return null
    const cardImageData = cardImages[selectedCard.id]
    const currentImageUrl = cardImageData?.[selectedLevel]

    const levelErrorKey = `${selectedCard.id}-${selectedLevel}`
    const hasError = imageErrors.has(levelErrorKey)

    const selectedIdLower = selectedCard.id?.toLowerCase() || ''
    const deckForgebornIdLower = deck?.forgebornId?.toLowerCase() || ''
    const currentForgebornIdLower = (deck as any)?.currentForgebornId?.toLowerCase() || ''
    const deckForgebornObjectIdLower = (deck as any)?.forgeborn?.id?.toLowerCase() || ''
    const cardTypeLower = selectedCard.type?.toLowerCase() || ''
    const cardTypeAltLower = (selectedCard as any).cardType?.toLowerCase() || ''

    const isForgeborn =
      (!!selectedIdLower && !!deckForgebornIdLower && (selectedIdLower === deckForgebornIdLower || selectedIdLower.includes(deckForgebornIdLower) || deckForgebornIdLower.includes(selectedIdLower))) ||
      (!!selectedIdLower && !!currentForgebornIdLower && (selectedIdLower === currentForgebornIdLower || selectedIdLower.includes(currentForgebornIdLower) || currentForgebornIdLower.includes(selectedIdLower))) ||
      (!!selectedIdLower && !!deckForgebornObjectIdLower && (selectedIdLower === deckForgebornObjectIdLower || selectedIdLower.includes(deckForgebornObjectIdLower) || deckForgebornObjectIdLower.includes(selectedIdLower))) ||
      cardTypeLower.includes('forgeborn') ||
      cardTypeAltLower.includes('forgeborn')

    const selectedCardData = selectedCard as any
    const isSolbind = solbindCardIdsSet.has(selectedCard.id) ||
                     selectedCardData.rarity === 'Solbind' || selectedCardData.rarity === 'solbind' ||
                     selectedCard.type?.toLowerCase() === 'solbind' ||
                     selectedCardData.cardType?.toLowerCase() === 'solbind'

    const effectiveLevel = selectedLevel
    const effectiveImageUrl = currentImageUrl

    const availableLevels = cardImageData ? Object.keys(cardImageData).map(Number).sort() : []
    const hasAllLevels = availableLevels.length === 3 && availableLevels.includes(1) && availableLevels.includes(2) && availableLevels.includes(3)
    const shouldEnableMouseScroll = !isForgeborn && hasAllLevels

    const baseFrameWidthPx = compact ? 240 : 288
    const baseFrameHeightPx = compact ? 380 : 480
    const frameWidthPx = baseFrameWidthPx
    const frameHeightPx = baseFrameHeightPx
    const isResizedForgeborn = isForgeborn && !!effectiveImageUrl && effectiveImageUrl.includes('/resized/')
    const shouldRotateForgeborn = isForgeborn && !isResizedForgeborn
    const forgebornScale = isForgeborn
      ? shouldRotateForgeborn
        ? (isMdUp ? 1.44 : 1.15)
        : (isMdUp ? 2.2 : 1.5)
      : 1
    const forgebornPositionStyle = isForgeborn ? { top: '50%', left: '50%' } : {}
    const forgebornTransform = isForgeborn
      ? `${shouldRotateForgeborn ? 'rotate(-90deg) ' : ''}translate(-50%, -48%) scale(${forgebornScale})`
      : 'none'

    const imageKey = effectiveImageUrl ? `${selectedCard.id}-${effectiveLevel}-${effectiveImageUrl}` : ''
    const isImageReady = !!(imageKey && imageLoadStatus[imageKey])

    return (
      <Paper
        p={compact ? 'xs' : 'xl'}
        className="backdrop-blur-md border border-sf-primary/30 rounded-lg"
        style={{
          backgroundColor: 'rgba(30, 41, 59, 0.6)',
          minHeight: compact ? 'auto' : '42vh',
          maxHeight: compact ? 'none' : '52vh',
          width: compact ? '100%' : detailPanelWidth,
          minWidth: compact ? '0' : detailPanelMinWidth,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          overflow: compact ? 'visible' : 'hidden',
        }}
      >
        <div className="text-center w-full">
          {!hasError ? (
            <div
              className="relative w-full flex flex-col items-center justify-center"
              style={{ gap: '0.15rem', marginTop: compact ? 0 : '-1.5rem' }}
            >
              <div
                className="relative w-full flex items-center justify-center"
                style={{
                  width: `min(${frameWidthPx}px, ${compact ? '88vw' : '70vw'})`,
                  height: compact ? `${frameHeightPx}px` : `min(${frameHeightPx}px, 70vh)`,
                }}
              >
                {effectiveImageUrl && (
                  <NextImage
                    key={imageKey || selectedCard.id}
                    src={effectiveImageUrl}
                    alt={isForgeborn ? selectedCard.name : isSolbind ? selectedCard.name : `${selectedCard.name} Level ${effectiveLevel}`}
                    fill
                    unoptimized
                    className="object-contain"
                    sizes={compact ? '(max-width: 62em) 88vw, 420px' : '(max-width: 1024px) 80vw, 420px'}
                    style={{
                      ...forgebornPositionStyle,
                      transform: forgebornTransform,
                      transformOrigin: 'center center',
                      opacity: isImageReady ? 1 : 0,
                      transition: 'opacity 120ms ease',
                    }}
                    onMouseMove={shouldEnableMouseScroll ? handleMouseMove : undefined}
                    onMouseLeave={shouldEnableMouseScroll ? handleMouseLeave : undefined}
                    onLoad={() => {
                      if (imageKey) {
                        setImageLoadStatus(prev => ({ ...prev, [imageKey]: true }))
                      }
                    }}
                    onError={() => {
                      setImageErrors(prev => new Set(prev).add(`${selectedCard.id}-${effectiveLevel}`))
                      if (imageKey) {
                        setImageLoadStatus(prev => ({ ...prev, [imageKey]: false }))
                      }
                    }}
                  />
                )}

                {(!effectiveImageUrl || !isImageReady) && (
                  <div
                    className="absolute inset-0 rounded-lg border-2 flex flex-col items-center justify-center gap-2"
                    style={{
                      backgroundColor: 'rgba(74, 144, 226, 0.1)',
                      borderColor: getFactionBadgeColor(selectedCard.faction || deck?.faction),
                    }}
                  >
                    <Loader size="md" color="rgba(74, 144, 226, 0.8)" />
                    <Text size="sm" className="text-white text-center px-4">
                      Loading {selectedCard.name} Level {effectiveLevel}...
                    </Text>
                  </div>
                )}
              </div>

              {!isForgeborn && (
                <Group gap="xs" justify="center" style={{ marginTop: compact ? '0.1rem' : '-1.5rem' }}>
                  {([1, 2, 3] as const)
                    .filter(level => {
                      if (!isSolbind) return true
                      const hasImage = !!cardImages[selectedCard.id]?.[level]
                      return hasImage
                    })
                    .map(level => {
                      const hasImage = cardImages[selectedCard.id]?.[level]
                      const levelErrorKey = `${selectedCard.id}-${level}`
                      const isLoading = !hasImage && !imageErrors.has(levelErrorKey) && loadingLevels[selectedCard.id]?.[level] !== false

                      return (
                        <Button
                          key={level}
                          size="sm"
                          variant={selectedLevel === level ? 'filled' : 'outline'}
                          onClick={() => handleLevelChange(level)}
                          className={
                            selectedLevel === level
                              ? 'bg-sf-primary hover:bg-sf-primary/90'
                              : 'border-sf-primary/50 text-sf-primary hover:bg-sf-primary/20'
                          }
                        >
                          Level {level}
                          {isLoading && ' (loading...)'}
                        </Button>
                      )
                    })}
                </Group>
              )}
            </div>
          ) : (
            <div
              className="w-64 h-96 mx-auto rounded-lg border-2 flex items-center justify-center"
              style={{
                backgroundColor: 'rgba(74, 144, 226, 0.1)',
                borderColor: getFactionBadgeColor(selectedCard.faction || deck?.faction),
              }}
            >
              <Text size="lg" className="text-white text-center px-4">
                {selectedCard.name}
              </Text>
            </div>
          )}
        </div>
      </Paper>
    )
  }, [
    selectedCard,
    cardImages,
    selectedLevel,
    imageErrors,
    deck,
    solbindCardIdsSet,
    imageLoadStatus,
    isMdUp,
    detailPanelWidth,
    detailPanelMinWidth,
    handleMouseMove,
    handleMouseLeave,
    handleLevelChange,
    loadingLevels,
  ])

  const spellCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    return uniqueNormalizedCards.filter(card => {
      if (forgebornCards.includes(card)) return false
      const cardData = card as any
      const meta = originalCardMeta.get((card.id || '').toLowerCase())
      const info = getCardInfo(card.id, cardData)
      const rawType = cardData.cardType || cardData.card_type || cardData.type || meta?.cardType || meta?.type || info.cardType || (info as any)?.type || ''
      const lowerCardType = rawType.toLowerCase()
      return lowerCardType.includes('spell') && !lowerCardType.includes('creature')
    })
  }, [uniqueNormalizedCards, forgebornCards, deck, originalCardMeta])

  const creatureCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    // Create sets of IDs for faster lookup
    const forgebornIds = new Set(
      [
        ...forgebornCards.map(fb => fb.id).filter(Boolean),
        ...(Array.isArray((deck as any)?.myDecks)
          ? (deck as any).myDecks.map((d: any) => d?.forgeborn?.id).filter(Boolean)
          : []),
      ].map((id: string) => id as string)
    )
    const spellIds = new Set(spellCards.map(sp => sp.id).filter(Boolean))
    const solbindIds = new Set(solbindCards.map(sb => sb.id).filter(Boolean))
    
    return uniqueNormalizedCards.filter(card => {
      if (!card.id) return false
      const cardData = card as any
      const meta = originalCardMeta.get((card.id || '').toLowerCase())
      const info = getCardInfo(card.id, cardData)
      const rawType = cardData.cardType || cardData.type || meta?.cardType || meta?.type || info.cardType || (info as any)?.type || ''
      const cardTypeLower = rawType.toLowerCase()
      // Check if card is forgeborn by ID (handles variants like s2nn1cercee324 vs s2nn1cercee431)
      const isForgeborn = forgebornIds.has(card.id) || 
        Array.from(forgebornIds).some(fbId => {
          if (!fbId || !card.id) return false
          const fbBase = fbId.replace(/\d+$/, '').toLowerCase()
          const cardBase = card.id.replace(/\d+$/, '').toLowerCase()
          return fbBase === cardBase && (fbBase.includes('cercee') || fbBase.includes('ironbeard') || fbBase.includes('xerxes') || fbBase.includes('kitaru'))
        }) ||
        cardTypeLower.includes('forgeborn')
      return !isForgeborn && !spellIds.has(card.id) && !solbindIds.has(card.id)
    })
  }, [uniqueNormalizedCards, forgebornCards, spellCards, solbindCards, deck, originalCardMeta])

  const getFactionColor = useCallback((faction?: string) => {
    switch (faction) {
      case 'Alloyin': return 'cyan'
      case 'Uterra': return 'teal'
      case 'Tempys': return 'orange'
      case 'Nekrium': return 'grape'
      default: return 'gray'
    }
  }, [])

  // getFactionBadgeColor moved outside component for better performance

  // Get rarity icon path based on card set and rarity
  // Helper function to check if a card is from B1/B2/B3 set
  const getBSetFromCard = useCallback((card: CardInfo | any): 'B1' | 'B2' | 'B3' | null => {
    if (!card) return null

    const cardData = card as any
    const cardSetId = cardData.cardSetId || cardData.CardSetId || cardData.SK || cardData.sk
    const cardId = card.id || cardData.id || cardData.cardId || cardData.name
    const setLower = cardSetId ? String(cardSetId).toLowerCase() : ''

    if (setLower === 'b3') return 'B3'
    if (setLower === 'b2') return 'B2'
    if (setLower === 'b1') return 'B1'
    if (cardId && /^b3_/i.test(cardId)) return 'B3'
    if (cardId && /^b2_/i.test(cardId)) return 'B2'
    if (cardId && /^b1_/i.test(cardId)) return 'B1'

    return null
  }, [])

  const getBSetFromCards = useCallback((cards: any[]): 'B1' | 'B2' | 'B3' | null => {
    let found: 'B1' | 'B2' | 'B3' | null = null
    cards.forEach((card) => {
      const bSet = getBSetFromCard(card)
      if (bSet === 'B3') {
        found = 'B3'
      } else if (bSet === 'B2') {
        found = 'B2'
      } else if (bSet === 'B1' && found !== 'B2') {
        found = 'B1'
      }
    })
    return found
  }, [getBSetFromCard])

  // Helper function to determine deck set: if any card is from B1/B2/B3, return that set, otherwise use deck.cardSetNo
  const getDeckSet = useCallback((deck: Deck | null, normalizedCards: CardInfo[]): string | null => {
    if (!deck) return null
    
    const deckAny = deck as any
    const deckSetId = deckAny.cardSetId || deckAny.card_set_id
    if (deckSetId) {
      const lower = String(deckSetId).toLowerCase()
      if (lower === 'b3') return 'B3'
      if (lower === 'b2') return 'B2'
      if (lower === 'b1') return 'B1'
    }
    
    // For fused decks, check cards from source decks (myDecks) if normalizedCards is empty
    if (deckAny.format === 'Fused' && normalizedCards.length === 0) {
      // Check source decks (myDecks) for B1/B2 cards
      if (deckAny.myDecks && Array.isArray(deckAny.myDecks)) {
        for (const sourceDeck of deckAny.myDecks) {
          if (sourceDeck && sourceDeck.cards && Array.isArray(sourceDeck.cards)) {
            const bSet = getBSetFromCards(sourceDeck.cards)
            if (bSet) return bSet
          }
        }
      }
      
      // If no B1 cards found in source decks, return null (fused decks don't have cardSetNo)
      return null
    }
    
    // Check if any card in normalizedCards is from B1/B2 set
    const bSet = getBSetFromCards(normalizedCards)
    if (bSet) return bSet
    
    // Otherwise use deck.cardSetNo
    return deck.cardSetNo || null
  }, [getBSetFromCards])

  const getDeckSetForDeck = useCallback((deckToCheck: Deck | null): string | null => {
    if (!deckToCheck) return null
    const cardsArr = (deckToCheck as any).cards
    const normalizedForSet = Array.isArray(cardsArr)
      ? cardsArr.map((card: any, index: number) => {
          if (typeof card === 'string') return getCardInfo(card)
          if (typeof card === 'object' && card !== null) {
            const cardId = card.id || card.cardId || card.name || `card-${index}`
            return getCardInfo(cardId, card)
          }
          return getCardInfo(`card-${index}`)
        })
      : []
    return getDeckSet(deckToCheck, normalizedForSet)
  }, [getDeckSet])
  
  // Helper function to format set name: "1" -> "S1", "2" -> "S2", "B1" -> "B1", "B2" -> "B2", "B3" -> "B3", etc.
  const formatSetName = useCallback((setNo: string | number | null | undefined): string | null => {
    if (!setNo) return null
    
    const setStr = String(setNo).trim()
    
    // If it's already B1/B2/B3, return uppercase
    if (setStr.toUpperCase() === 'B1' || setStr.toLowerCase() === 'b1') {
      return 'B1'
    }
    if (setStr.toUpperCase() === 'B2' || setStr.toLowerCase() === 'b2') {
      return 'B2'
    }
    if (setStr.toUpperCase() === 'B3' || setStr.toLowerCase() === 'b3') {
      return 'B3'
    }
    
    // For numeric sets, format as S1, S2, S3, etc.
    const numericMatch = setStr.match(/^(\d+)$/)
    if (numericMatch) {
      return `S${numericMatch[1]}`
    }
    
    // If it already starts with S, return as is (but uppercase S)
    if (/^s\d+/i.test(setStr)) {
      return setStr.toUpperCase()
    }
    
    // Otherwise return as is
    return setStr
  }, [])

  const getRarityIconPath = useCallback((cardSetNo?: string | number, rarity?: string, cardId?: string, cardData?: any): string | null => {
    if (!rarity) return null
    
    // Normalize rarity: "Common Rare" -> "CommonRare", "common rare" -> "CommonRare", etc.
    let normalizedRarity = rarity.trim()
    const lowerRarity = normalizedRarity.toLowerCase()
    
    // Handle "Common Common" -> "CommonCommon" (spliced cards with two Common parts)
    // Check for "common common" pattern (two words "common" separated by space)
    if (lowerRarity === 'common common' || lowerRarity.match(/^common\s+common$/)) {
      normalizedRarity = 'CommonCommon'
    }
    // Handle "Rare Rare" -> "RareRare" (spliced cards with two Rare parts)
    else if (lowerRarity === 'rare rare' || lowerRarity.match(/^rare\s+rare$/)) {
      normalizedRarity = 'RareRare'
    }
    // Handle Darkforge Rare
    else if (lowerRarity.includes('darkforge') && lowerRarity.includes('rare')) {
      normalizedRarity = 'DarkforgeRare'
    }
    // Handle Darkforge Common / Darkforge LS
    else if (lowerRarity.includes('darkforge') && lowerRarity.includes('common')) {
      normalizedRarity = 'DarkforgeCommon'
    } else if (lowerRarity.includes('darkforge') && (lowerRarity.includes('ls') || lowerRarity.includes('legendary'))) {
      normalizedRarity = 'Darkforge LS'
    }
    // Handle "Rare Common" or "rare common" -> "RareCommon" (order matters: Rare first, then Common)
    else if (lowerRarity.match(/^rare\s+common$/i) || (lowerRarity.startsWith('rare') && lowerRarity.includes('common') && !lowerRarity.startsWith('common'))) {
      normalizedRarity = 'RareCommon'
    }
    // Handle "Common Rare" or "common rare" -> "CommonRare" (order matters: Common first, then Rare)
    else if (lowerRarity.match(/^common\s+rare$/i) || (lowerRarity.startsWith('common') && lowerRarity.includes('rare'))) {
      normalizedRarity = 'CommonRare'
    }
    // Fallback: if both words present but order unclear, default to CommonRare
    else if (lowerRarity.includes('common') && lowerRarity.includes('rare')) {
      normalizedRarity = 'CommonRare'
    } else if (lowerRarity.includes('common') && !lowerRarity.includes('rare')) {
      normalizedRarity = 'Common'
    } else if (lowerRarity.includes('rare') && !lowerRarity.includes('common')) {
      normalizedRarity = 'Rare'
    } else if (lowerRarity.includes('darkforge')) {
      normalizedRarity = 'Darkforge'
    } else if (lowerRarity.includes('ls') || lowerRarity.includes('legendary')) {
      normalizedRarity = 'LS'
    } else if (lowerRarity.includes('solbind')) {
      normalizedRarity = 'Solbind'
    }
    
    // Get card set from card data first (cardSetId or SK), then fallback to cardSetNo parameter, then cardId
    let cardSet: string | undefined = undefined
    
    // Try to get cardSetId or SK from cardData (most reliable - per-card set information)
    if (cardData) {
      cardSet = cardData.cardSetId || cardData.CardSetId || cardData.SK || cardData.sk
      // SK might be in format like "b1", "b2", or "s3", normalize it
      if (cardSet) {
        cardSet = String(cardSet).toLowerCase().trim()
      }
    }
    
    // Fallback to cardSetNo parameter
    if (!cardSet && cardSetNo) {
      cardSet = String(cardSetNo).toLowerCase().trim()
    }
    
    // Fallback: try to extract from cardId
    if (!cardSet && cardId) {
      // Check for b3_/b2_/b1_ prefix first
      if (/^b3_/i.test(cardId)) {
        cardSet = 'b3'
      } else if (/^b2_/i.test(cardId)) {
        cardSet = 'b2'
      } else if (/^b1_/i.test(cardId)) {
        cardSet = 'b1'
      } else {
        // Extract set number from cardId (e.g., "s3nn1arrogant-butcher" -> "3")
        const match = cardId.match(/^s(\d+)/i)
        if (match && match[1]) {
          cardSet = `s${match[1]}`
        }
      }
    }
    
    // Check if this is B1/B2/B3 set (Betrayer sets)
    const isB3Set =
      (cardSet && (cardSet.toUpperCase() === 'B3' || cardSet === 'b3')) ||
      (cardId && /^b3_/i.test(cardId))
    const isB2Set =
      (cardSet && (cardSet.toUpperCase() === 'B2' || cardSet === 'b2')) ||
      (cardId && /^b2_/i.test(cardId))
    const isB1Set =
      (cardSet && (cardSet.toUpperCase() === 'B1' || cardSet === 'b1')) ||
      (cardId && /^b1_/i.test(cardId))
    
    const iconRarity = normalizedRarity === 'Darkforge LS' ? 'Darkforge_LS' : normalizedRarity

    if (isB3Set) {
      return `/images/icons/rarity/B3_${iconRarity}.png`
    }
    if (isB2Set) {
      return `/images/icons/rarity/B2_${iconRarity}.png`
    }
    if (isB1Set) {
      return `/images/icons/rarity/B1_${iconRarity}.png`
    }
    
    // Get set number for S sets: extract number from cardSet (e.g., "s3" -> "3", "3" -> "3")
    let setNo = '1'
    if (cardSet) {
      // Remove "s" prefix if present and extract number
      const match = cardSet.match(/^s?(\d+)/i)
      if (match && match[1]) {
        setNo = match[1]
      } else {
        // If it's just a number, use it directly
        setNo = cardSet
      }
    }
    
    // For set 99, use set 1 icons (s1_*.png)
    if (setNo === '99') {
      setNo = '1'
    }
    
    // Return local path for all rarities (including CommonCommon and RareRare)
    return `/images/icons/rarity/S${setNo}_${iconRarity}.png`
  }, [])

  // Determine deck set (B1 if any card is from B1, otherwise deck.cardSetNo)
  const deckSet = useMemo(() => {
    const deckForUse = deckForDisplay
    if (!deckForUse) return null
    const byCards = getDeckSet(deckForUse, normalizedCards)
    if (byCards) return byCards
    return deckForUse.computed?.deckSet || null
  }, [deckForDisplay, normalizedCards, getDeckSet])
  
  const formattedDeckSet = useMemo(() => {
    return formatSetName(deckSet)
  }, [deckSet, formatSetName])

  const derivedFaction = useMemo(() => {
    const d = deckForDisplay as any
    if (d?.faction) return d.faction
    const factionCounts = new Map<string, number>()
    uniqueNormalizedCards.forEach((card) => {
      const f = (card as any)?.faction || (card as any)?.Faction || (card as any)?.factionName
      if (f && typeof f === 'string') {
        factionCounts.set(f, (factionCounts.get(f) || 0) + 1)
      }
    })
    if (factionCounts.size === 0) return null
    let top: string | null = null
    let topCount = 0
    factionCounts.forEach((count, f) => {
      if (count > topCount) {
        top = f
        topCount = count
      }
    })
    return top
  }, [deckForDisplay, uniqueNormalizedCards])

  const expireInfo = useMemo(() => {
    const d = deckForDisplay as any
    if (!d) return { label: null, isExpired: false }

    const resolveExpiryTimestamp = (candidate: any): number | null => {
      if (!candidate) return null
      const computedTs = candidate.computed?.expiryTs
      if (Number.isFinite(computedTs)) return computedTs as number
      const expireRaw =
        candidate.expireAt ??
        candidate.expire ??
        candidate.expire_at ??
        candidate.expireDate ??
        candidate.expire_date ??
        candidate.expiry ??
        candidate.pExpiry ??
        null
      if (!expireRaw) return null
      const ts = new Date(expireRaw).getTime()
      return Number.isNaN(ts) ? null : ts
    }

    const formatLabel = (ts: number) =>
      new Date(ts).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })

    let ts: number | null = null

    if (isFusedDeckLike(d)) {
      const seen = new Set<string>()
      const sources: any[] = []
      const pushSource = (source: any) => {
        if (!source) return
        const key = source.id || source.deckId || source.name
        if (key) {
          if (seen.has(String(key))) return
          seen.add(String(key))
        }
        sources.push(source)
      }

      const [half1, half2] = getFusedDeckSourceDecks
      pushSource(half1)
      pushSource(half2)
      fusedSourceDecks.forEach(pushSource)
      if (Array.isArray(d.myDecks)) d.myDecks.forEach(pushSource)
      Object.values(halfDetails).forEach(pushSource)

      const halfExpiry = sources
        .map(resolveExpiryTimestamp)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

      if (halfExpiry.length > 0) {
        ts = Math.min(...halfExpiry)
      }
    }

    if (ts === null) {
      ts = resolveExpiryTimestamp(d)
    }

    if (ts === null) return { label: null, isExpired: false }

    return {
      label: formatLabel(ts),
      isExpired: ts < Date.now(),
    }
  }, [deckForDisplay, fusedSourceDecks, halfDetails, getFusedDeckSourceDecks])

  const copyDeckLink = useCallback(() => {
    if (!deck?.id) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = origin ? `${origin}/deck/${deck.id}` : `/deck/${deck.id}`
    const showCopied = () => {
      setCopied(true)
      notifications.show({
        title: 'Copied',
        message: 'Deck link copied to clipboard',
        color: 'teal',
      })
    }

    const fallbackCopy = () => {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = url
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        showCopied()
      } catch (err) {
        console.error('[DeckDetails] Copy fallback failed:', err)
      }
    }

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => showCopied()).catch(() => fallbackCopy())
    } else {
      fallbackCopy()
    }
  }, [deck?.id])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  // Early return AFTER all hooks
  if (!deck) return null

  // Helper to compute CardListItem props from card data
  const getCardListItemProps = (card: CardInfo) => {
    const cardData = card as any
    const isBetrayer = cardData.betrayer === true || cardData.betrayer === 'true'
    const isForgeborn = deck?.forgebornId === card.id || 
                       card.id === deck?.forgebornId ||
                       (card.id && deck?.forgebornId && card.id.includes(deck.forgebornId)) ||
                       (deck?.forgebornId && card.id && deck.forgebornId.includes(card.id)) ||
                       card.type?.toLowerCase().includes('forgeborn') ||
                       cardData.cardType?.toLowerCase().includes('forgeborn')
    const factionForIcon = isBetrayer && cardData.crossFaction 
      ? cardData.crossFaction 
      : (card.faction || deck.faction)
    const faction = (factionForIcon || '').toLowerCase()
    const rarity = cardData.rarity || card.rarity

    const factionIconKey = faction ? `faction:${faction}` : null
    const factionRawPath = faction ? `/images/icons/${faction}.png` : null
    const factionIconPath = getCachedIconPath(factionIconKey, factionRawPath)

    const rarityRawPath = !isForgeborn
      ? getRarityIconPath(deckSet || deck?.cardSetNo, rarity, card.id, cardData)
      : null
    // Cache by actual icon path to avoid mixing sets for the same rarity.
    const rarityIconKey = rarityRawPath ? `rarity:${rarityRawPath}` : null
    const rarityIconPath = getCachedIconPath(rarityIconKey, rarityRawPath)

    return {
      factionIconPath,
      rarityIconPath,
      factionColor: getFactionBadgeColor(factionForIcon),
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      transitionProps={{ duration: 0 }}
      overlayProps={{
        backgroundOpacity: 0.6,
        blur: 0,
      }}
      closeOnClickOutside={true}
      closeOnEscape={true}
      keepMounted={false}
      title={
        <Group justify="space-between" className="w-full" wrap="wrap">
          <Group gap="md" wrap="wrap" className="flex-1 min-w-0">
            {parentFusedDeck && (
              <Button
                variant="subtle"
                size="xs"
                color="blue"
                onClick={(e) => {
                  e.stopPropagation()
                  // Pass null as parentDeck to clear parentFusedDeck when returning to fused deck
                  onDeckClick(parentFusedDeck, null)
                }}
                style={{ flexShrink: 0 }}
              >
                ← Back to Fused
              </Button>
            )}
            <Group gap="xs" wrap="wrap">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  copyDeckLink()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'none',
                  border: 'none',
                  padding: '4px 0',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '6px',
                    borderRadius: '50%',
                    backgroundColor: copied ? 'rgba(20, 184, 166, 0.18)' : 'rgba(148, 163, 184, 0.08)',
                    transition: 'background-color 150ms ease, transform 120ms ease, color 150ms ease',
                    color: copied ? '#14b8a6' : '#cbd5e1',
                  }}
                >
                  <IconCopy size={16} />
                </div>
                <Title
                  order={3}
                  className="text-white"
                  style={{
                    margin: 0,
                    textDecoration: copied ? 'underline' : 'none',
                    whiteSpace: 'normal',
                    lineHeight: 1.2,
                  }}
                >
                  {(deckForDisplay || deck)?.name || 'Untitled Deck'}
                </Title>
              </button>
              {/* Don't show faction/set badges for fused decks */}
              {formattedDeckSet && (deckForDisplay as any)?.format !== 'Fused' && (
                <Group gap={4} wrap="wrap">
                  {derivedFaction && (
                    <Image
                      src={`/images/icons/${derivedFaction.toLowerCase()}.png`}
                      alt={derivedFaction}
                      h={20}
                      w="auto"
                      style={{
                        display: 'inline-block',
                        verticalAlign: 'middle',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Badge
                    color="indigo"
                    variant="light"
                    size="sm"
                  >
                    {formattedDeckSet}
                  </Badge>
                </Group>
              )}
              {/* Owner / Expire badges directly under the title */}
              {(() => {
                const d = (deckForDisplay || deck) as any
                const ownerName = d.username || d.playerName || null
                const expireLabel = expireInfo.label
                const isExpired = expireInfo.isExpired
                if (!ownerName && !expireLabel) return null

                return (
                  <Group gap="xs" wrap="wrap">
                    {ownerName && (
                      <Badge
                        component="a"
                        href={`/player/${encodeURIComponent(ownerName)}`}
                        color="teal"
                        variant="light"
                        size="sm"
                        radius="sm"
                        style={{ textDecoration: 'none' }}
                      >
                        Owner: {ownerName as string}
                      </Badge>
                    )}
                    {expireLabel && (
                      <Badge
                        color={undefined}
                        variant="filled"
                        size="sm"
                        radius="sm"
                        style={
                          isExpired
                            ? {
                                backgroundColor: '#000',
                                color: '#fff',
                                border: '1px solid #000',
                              }
                            : {
                                backgroundColor: '#b32626',
                                color: '#fff',
                                border: '1px solid #b32626',
                              }
                        }
                      >
                        Expire date: {expireLabel}
                      </Badge>
                    )}
                  </Group>
                )
              })()}
            </Group>
            <Group gap="xs" wrap="wrap">
              {(() => {
                const rank = (deckForDisplay as any)?.deckRank ?? (deck as any)?.deckRank
                if (!rank) return null
                return (
                  <Badge
                    color={rank === 'Unranked' ? 'gray' : 'blue'}
                    variant="light"
                    size="sm"
                  >
                    {rank}
                  </Badge>
                )
              })()}
              {(() => {
                const formatLabel = (deckForDisplay as any)?.format ?? (deck as any)?.format
                if (!formatLabel) return null
                return (
                  <Badge
                    color="gray"
                    variant="light"
                    size="sm"
                  >
                    {formatLabel}
                  </Badge>
                )
              })()}
            </Group>
            {deck && (
              (() => {
                const isFused = ((deckForDisplay as any)?.format ?? (deck as any)?.format) === 'Fused'
                const solforgefusionUrl = isFused 
                  ? `https://solforgefusion.com/fused/${deck.id}`
                  : `https://solforgefusion.com/decks/${deck.id}`
                
                return (
                  <Group gap="xs" wrap="wrap">
                    {isFused ? (
                      <Button
                        component="a"
                        href={`https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/fuseddeck/${deck.id}?inclCards=true&inclUsers=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="subtle"
                        size="xs"
                        color="blue"
                        leftSection={<IconExternalLink size={14} />}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flexShrink: 0 }}
                      >
                        API
                      </Button>
                    ) : (
                      <Button
                        component="a"
                        href={`https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/deck/${deck.id}?inclCards=true&inclUsers=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="subtle"
                        size="xs"
                        color="blue"
                        leftSection={<IconExternalLink size={14} />}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flexShrink: 0 }}
                      >
                        API
                      </Button>
                    )}
                    <Button
                      component="a"
                      href={solforgefusionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="subtle"
                      size="xs"
                      color="blue"
                      leftSection={<IconWorld size={14} />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flexShrink: 0 }}
                    >
                      SFF
                    </Button>
                  </Group>
                )
              })()
            )}
            <Group gap="xs" wrap="wrap">
              {(() => {
                const score = (deckForDisplay as any)?.deckScore ?? (deck as any)?.deckScore
                if (score === undefined || score === null) return null
                const val = typeof score === 'number' ? Math.round(score * 100) : score
                return (
                  <Badge
                    color="grape"
                    variant="light"
                    size="sm"
                  >
                    Score: {val}
                  </Badge>
                )
              })()}
            {(() => {
              const elo = (deckForDisplay as any)?.elo ?? (deck as any)?.elo
              if (elo === undefined || elo === null) return null
              const val = typeof elo === 'number' ? Math.round(elo) : elo
              return (
                  <Badge
                    color="violet"
                    variant="light"
                    size="sm"
                  >
                    ELO: {val}
                  </Badge>
                )
              })()}
            </Group>
            {(() => {
              const [sourceDeck1, sourceDeck2] = getFusedDeckSourceDecks
              const sourceDeck1Set = formatSetName(getDeckSetForDeck(sourceDeck1))
              const sourceDeck2Set = formatSetName(getDeckSetForDeck(sourceDeck2))
              
              if (sourceDeck1 || sourceDeck2) {
                return (
                  <Group gap="xs" wrap="wrap">
                    {sourceDeck1 && (
                      <Stack gap={4} style={{ flexShrink: 0 }}>
                        {(() => {
                          const meta = renderSourceDeckMeta(sourceDeck1)
                          return (
                            <>
                              <Text
                                size="xs"
                                className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // Pass current deck as parent when navigating to source deck
                                  onDeckClick(sourceDeck1, deck)
                                }}
                                style={{ textDecorationThickness: '1px' }}
                              >
                                {sourceDeck1.name || 'Deck 1'}
                              </Text>
                              {(sourceDeck1Set || meta) && (
                                <Group gap={6} wrap="wrap">
                                  {sourceDeck1Set && (
                                    <Group gap={6} wrap="wrap">
                                      {sourceDeck1.faction && (
                                        <Image
                                          src={`/images/icons/${sourceDeck1.faction.toLowerCase()}.png`}
                                          alt={sourceDeck1.faction}
                                          h={20}
                                          w="auto"
                                          style={{
                                            display: 'inline-block',
                                            verticalAlign: 'middle',
                                            flexShrink: 0,
                                          }}
                                        />
                                      )}
                                      <Badge
                                        color="indigo"
                                        variant="light"
                                        size="xs"
                                      >
                                        {sourceDeck1Set}
                                      </Badge>
                                    </Group>
                                  )}
                                  {meta}
                                </Group>
                              )}
                            </>
                          )
                        })()}
                      </Stack>
                    )}
                    {sourceDeck1 && sourceDeck2 && (
                      <Text size="xs" className="text-gray-500">
                        +
                      </Text>
                    )}
                    {sourceDeck2 && (
                      <Stack gap={4} style={{ flexShrink: 0 }}>
                        {(() => {
                          const meta = renderSourceDeckMeta(sourceDeck2)
                          return (
                            <>
                              <Text
                                size="xs"
                                className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // Pass current deck as parent when navigating to source deck
                                  onDeckClick(sourceDeck2, deck)
                                }}
                                style={{ textDecorationThickness: '1px' }}
                              >
                                {sourceDeck2.name || 'Deck 2'}
                              </Text>
                              {(sourceDeck2Set || meta) && (
                                <Group gap={6} wrap="wrap">
                                  {sourceDeck2Set && (
                                    <Group gap={6} wrap="wrap">
                                      {sourceDeck2.faction && (
                                        <Image
                                          src={`/images/icons/${sourceDeck2.faction.toLowerCase()}.png`}
                                          alt={sourceDeck2.faction}
                                          h={20}
                                          w="auto"
                                          style={{
                                            display: 'inline-block',
                                            verticalAlign: 'middle',
                                            flexShrink: 0,
                                          }}
                                        />
                                      )}
                                      <Badge
                                        color="indigo"
                                        variant="light"
                                        size="xs"
                                      >
                                        {sourceDeck2Set}
                                      </Badge>
                                    </Group>
                                  )}
                                  {meta}
                                </Group>
                              )}
                            </>
                          )
                        })()}
                      </Stack>
                    )}
                  </Group>
                )
              }
              return null
            })()}
          </Group>
        </Group>
      }
      size="95vw"
      centered
      styles={{
        content: {
          backgroundColor: 'rgba(30, 41, 59, 0.98)',
          border: '1px solid rgba(74, 144, 226, 0.3)',
          maxWidth: '1500px',
          width: modalWidth,
          minWidth: modalMinWidth,
          minHeight: isMdUp ? 'calc(80vh + 50px)' : 'calc(85vh - 24px)',
          overflowY: isMdUp ? 'hidden' : 'auto',
          overflowX: 'hidden',
          transition: 'transform 300ms ease-in-out, opacity 300ms ease-in-out',
        },
        header: {
          backgroundColor: 'rgba(30, 41, 59, 0.98)',
          borderBottom: '1px solid rgba(74, 144, 226, 0.2)',
        },
        body: {
          padding: '1.5rem',
          maxHeight: modalBodyMaxHeight,
          minHeight: isMdUp ? 'calc(70vh + 50px)' : 'auto',
          overflowY: isMdUp ? 'hidden' : undefined,
        },
        overlay: {
          transition: 'opacity 300ms ease-in-out, backdrop-filter 300ms ease-in-out',
        },
      }}
    >
      <div
        className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        style={{
          alignItems: 'flex-start',
          height: modalBodyInnerHeight,
          maxHeight: modalBodyInnerHeight,
        }}
      >
        {/* Left column - card lists */}
        <div
          className="lg:col-span-1 flex flex-col h-full"
          style={{
            height: modalBodyInnerHeight,
            maxHeight: modalBodyInnerHeight ?? 'none',
            overflowY: isMdUp ? 'auto' : 'visible',
          }}
        >
          <div className="flex-1" style={{ padding: 0 }}>
            <Stack gap="md" align="flex-start" style={{ padding: 0, margin: 0 }}>
              {/* Forgeborn */}
              {forgebornCards.length > 0 && (
                <div style={{ width: '100%' }}>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase" style={{ paddingLeft: 0 }}>
                    Forgeborn
                  </Text>
                  <Stack gap="xs" style={{ padding: 0, margin: 0 }}>
                    {forgebornCards.map((card, index) => {
                      const props = getCardListItemProps(card)
                      const isInline = !isMdUp && selectedCard?.id === card.id
                      return (
                        <CardListItem
                          key={`forgeborn-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
                          inlineFrame={isInline ? renderSelectedCardFrame(true) : null}
                          onClick={() => handleSelectCard(card)}
                        />
                      )
                    })}
                  </Stack>
                </div>
              )}

              {/* Creatures */}
              {creatureCards.length > 0 && (
                <div style={{ width: '100%' }}>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase" style={{ paddingLeft: 0 }}>
                    Creatures ({creatureCards.length})
                  </Text>
                  <Stack gap="xs" style={{ padding: 0, margin: 0 }}>
                    {creatureCards.map((card, index) => {
                      const props = getCardListItemProps(card)
                      const isInline = !isMdUp && selectedCard?.id === card.id
                      return (
                        <CardListItem
                          key={`creature-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
                          inlineFrame={isInline ? renderSelectedCardFrame(true) : null}
                          onClick={() => handleSelectCard(card)}
                        />
                      )
                    })}
                  </Stack>
                </div>
              )}

              {/* Spells */}
              {spellCards.length > 0 && (
                <div style={{ width: '100%' }}>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase" style={{ paddingLeft: 0 }}>
                    Spells ({spellCards.length})
                  </Text>
                  <Stack gap="xs" style={{ padding: 0, margin: 0 }}>
                    {spellCards.map((card, index) => {
                      const props = getCardListItemProps(card)
                      const isInline = !isMdUp && selectedCard?.id === card.id
                      return (
                        <CardListItem
                          key={`spell-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
                          inlineFrame={isInline ? renderSelectedCardFrame(true) : null}
                          onClick={() => handleSelectCard(card)}
                        />
                      )
                    })}
                  </Stack>
                </div>
              )}

              {/* Solbind */}
              {solbindCards.length > 0 && (
                <div style={{ width: '100%' }}>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase" style={{ paddingLeft: 0 }}>
                    Solbind ({solbindCards.length})
                  </Text>
                  <Stack gap="xs" style={{ padding: 0, margin: 0 }}>
                    {solbindCards.map((card, index) => {
                      const props = getCardListItemProps(card)
                      const isInline = !isMdUp && selectedCard?.id === card.id
                      return (
                        <CardListItem
                          key={`solbind-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
                          inlineFrame={isInline ? renderSelectedCardFrame(true) : null}
                          onClick={() => handleSelectCard(card)}
                        />
                      )
                    })}
                  </Stack>
                </div>
              )}

              {/* If no categories, show all cards */}
              {forgebornCards.length === 0 && creatureCards.length === 0 && spellCards.length === 0 && solbindCards.length === 0 && normalizedCards.length > 0 && (
                <div style={{ width: '100%' }}>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase" style={{ paddingLeft: 0 }}>
                    Cards ({normalizedCards.length})
                  </Text>
                  <Stack gap="xs" style={{ padding: 0, margin: 0 }}>
                    {normalizedCards.map((card, index) => {
                      const props = getCardListItemProps(card)
                      const isInline = !isMdUp && selectedCard?.id === card.id
                      return (
                        <CardListItem
                          key={`card-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
                          inlineFrame={isInline ? renderSelectedCardFrame(true) : null}
                          onClick={() => handleSelectCard(card)}
                        />
                      )
                    })}
                  </Stack>
                </div>
              )}

              {!isMdUp && (deckTags.length > 0 || creatureTypeEntries.length > 0 || raritySummary.size > 0 || deckCounts.total > 0) && (
                <Paper
                  p="md"
                  className="backdrop-blur-md border border-sf-primary/30 rounded-lg"
                  style={{
                    backgroundColor: 'rgba(30, 41, 59, 0.6)',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  <Stack gap="xs">
                    <Group gap="xs" wrap="wrap">
                      {deckCounts.creatures ? (
                        <Badge color="green" variant="light" size="sm">
                          {pluralize(deckCounts.creatures, 'Creature')}
                        </Badge>
                      ) : null}
                      {deckCounts.spells ? (
                        <Badge color="pink" variant="light" size="sm">
                          {pluralize(deckCounts.spells, 'Spell')}
                        </Badge>
                      ) : null}
                      {deckCounts.solbind ? (
                        <Badge color="orange" variant="light" size="sm">
                          {pluralize(deckCounts.solbind, 'Solbind')}
                        </Badge>
                      ) : null}
                      {Array.from(raritySummary.entries())
                        .sort(([a], [b]) => {
                          const order: Record<string, number> = {
                            Solbind: 0,
                            Common: 1,
                            'Common Common': 2,
                            'Common Rare': 3,
                            Rare: 4,
                            'Rare Common': 5,
                            'Rare Rare': 6,
                            'Darkforge Common': 7,
                            'Darkforge Rare': 8,
                            Darkforge: 9,
                            'Darkforge LS': 10,
                            LS: 11,
                          }
                          return (order[a] ?? 99) - (order[b] ?? 99)
                        })
                        .map(([rarity, count]) => (
                          <Badge
                            key={`rarity-${rarity}`}
                            variant="light"
                            size="sm"
                            style={{ backgroundColor: getRarityBadgeColor(rarity), color: 'white', border: 'none' }}
                          >
                            {count} {rarity}
                          </Badge>
                        ))}
                    </Group>

                    {deckTags.length > 0 && (
                      <Group gap="xs" className="flex-wrap">
                        {deckTags.map((tag) => (
                          <Badge key={`tag-${tag}`} color="violet" variant="light" size="sm">
                            {tag.toString().toUpperCase()}
                          </Badge>
                        ))}
                      </Group>
                    )}

                    {creatureTypeEntries.length > 0 && (
                      <Group gap="xs" className="flex-wrap">
                        {creatureTypeEntries.map(([type, count]) => {
                          const pretty = type.charAt(0).toUpperCase() + type.slice(1)
                          return (
                            <Badge key={`ctype-${type}`} color="grape" variant="outline" size="sm">
                              {`${pretty} ${count}`}
                            </Badge>
                          )
                        })}
                      </Group>
                    )}
                  </Stack>
                </Paper>
              )}
            </Stack>
          </div>
        </div>

        {isMdUp ? (
          <div
            className="lg:col-span-2 flex flex-col h-full"
            style={detailPaneStyle}
          >
            {selectedCard ? (
              <Stack gap="lg">
                {renderSelectedCardFrame(false)}

                <Paper
                  p="md"
                  className="backdrop-blur-md border border-sf-primary/30 rounded-lg"
                  style={{
                    backgroundColor: 'rgba(30, 41, 59, 0.6)',
                    width: detailPanelWidth,
                    minWidth: detailPanelMinWidth,
                    boxSizing: 'border-box',
                  }}
                >
                  <Stack gap="xs">
                    <Group gap="xs" wrap="wrap">
                      {deckCounts.creatures ? (
                        <Badge color="green" variant="light" size="sm">
                          {pluralize(deckCounts.creatures, 'Creature')}
                        </Badge>
                      ) : null}
                      {deckCounts.spells ? (
                        <Badge color="pink" variant="light" size="sm">
                          {pluralize(deckCounts.spells, 'Spell')}
                        </Badge>
                      ) : null}
                      {deckCounts.solbind ? (
                        <Badge color="orange" variant="light" size="sm">
                          {pluralize(deckCounts.solbind, 'Solbind')}
                        </Badge>
                      ) : null}
                      {Array.from(raritySummary.entries())
                        .sort(([a], [b]) => {
          const order: Record<string, number> = {
            Solbind: 0,
            Common: 1,
            'Common Common': 2,
            'Common Rare': 3,
            Rare: 4,
            'Rare Common': 5,
            'Rare Rare': 6,
            'Darkforge Common': 7,
            'Darkforge Rare': 8,
            Darkforge: 9,
            'Darkforge LS': 10,
            LS: 11,
          }
                          return (order[a] ?? 99) - (order[b] ?? 99)
                        })
                        .map(([rarity, count]) => (
                          <Badge
                            key={`rarity-${rarity}`}
                            variant="light"
                            size="sm"
                            style={{ backgroundColor: getRarityBadgeColor(rarity), color: 'white', border: 'none' }}
                          >
                            {count} {rarity}
                          </Badge>
                        ))}
                    </Group>

                    {deckTags.length > 0 && (
                      <Group gap="xs" className="flex-wrap">
                        {deckTags.map((tag) => (
                          <Badge key={`tag-${tag}`} color="violet" variant="light" size="sm">
                            {tag.toString().toUpperCase()}
                          </Badge>
                        ))}
                      </Group>
                    )}

                    {creatureTypeEntries.length > 0 && (
                      <Group gap="xs" className="flex-wrap">
                        {creatureTypeEntries.map(([type, count]) => {
                          const pretty = type.charAt(0).toUpperCase() + type.slice(1)
                          return (
                            <Badge key={`ctype-${type}`} color="grape" variant="outline" size="sm">
                              {`${pretty} ${count}`}
                            </Badge>
                          )
                        })}
                      </Group>
                    )}
                  </Stack>
                </Paper>
              </Stack>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Text size="lg" className="text-gray-400">
                  Select a card to view details
                </Text>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
