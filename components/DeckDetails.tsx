'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { Modal, Stack, Paper, Title, Text, Group, Badge, Button, ScrollArea, Divider, Image, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconCopy, IconExternalLink, IconWorld } from '@tabler/icons-react'
import NextImage from 'next/image'
import type { Deck } from '@/store/deckStore'
import { formatCardName, getCardImageUrl, getCardImageUrls, getCardInfo, getForgebornAlternativeUrl, type CardInfo } from '@/lib/api'
import { logWithTimestamp } from '@/lib/logger'
import { pluralize } from '@/lib/pluralize'

// Fetch full deck details directly from API (faster than going through API route)
async function fetchDeckDetails(deckId: string): Promise<any> {
  try {
    const url = `https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/deck/${deckId}?inclCards=true&inclUsers=true`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data
  } catch (error) {
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

// Helper function to load a single image (stable, outside component to avoid TDZ)
async function loadSingleImage(cardId: string, level: number, isForgeborn: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const imageUrl = getCardImageUrl(cardId, level, isForgeborn)
    const img = new window.Image()
    const isSet99 = /^s99/i.test(cardId)
    
    const tryAlternativeUrl = (): void => {
      if (isSet99 && !isForgeborn) {
        const baseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards'
        let cleanId = cardId.replace(/[^a-z0-9\-_]/gi, '').toLowerCase()
        const cardLevel = Math.max(1, Math.min(3, level))
        const alternativeUrl = `${baseUrl}/${cleanId}_${cardLevel}.jpg`
        
        const altImg = new window.Image()
        const altTimeout = setTimeout(() => {
          resolve(null)
        }, 5000)
        
        altImg.onload = () => {
          clearTimeout(altTimeout)
          resolve(alternativeUrl)
        }
        altImg.onerror = () => {
          clearTimeout(altTimeout)
          const encodedId = encodeURIComponent(cardId)
          const encodedUrl = `${baseUrl}/${encodedId}_${cardLevel}.jpg`
          const encodedImg = new window.Image()
          const encodedTimeout = setTimeout(() => {
            resolve(null)
          }, 5000)
          
          encodedImg.onload = () => {
            clearTimeout(encodedTimeout)
            resolve(encodedUrl)
          }
          encodedImg.onerror = () => {
            clearTimeout(encodedTimeout)
            resolve(null)
          }
          encodedImg.src = encodedUrl
        }
        altImg.src = alternativeUrl
        return
      }
      
      if (isForgeborn && cardId.includes('-')) {
        const alternativeUrl = getForgebornAlternativeUrl(cardId)
        const altImg = new window.Image()
        const altTimeout = setTimeout(() => {
          resolve(null)
        }, 5000)
        
        altImg.onload = () => {
          clearTimeout(altTimeout)
          resolve(alternativeUrl)
        }
        altImg.onerror = () => {
          clearTimeout(altTimeout)
          resolve(null)
        }
        
        altImg.src = alternativeUrl
      } else {
        resolve(null)
      }
    }
    
    const timeout = setTimeout(() => {
      tryAlternativeUrl()
    }, isForgeborn ? 10000 : 5000)
    
    img.onload = () => {
      clearTimeout(timeout)
      resolve(imageUrl)
    }
    img.onerror = () => {
      clearTimeout(timeout)
      tryAlternativeUrl()
    }
    img.src = imageUrl
  })
}

// Memoized CardListItem component - defined outside to prevent recreation on each render
interface CardListItemProps {
  card: CardInfo
  isSelected: boolean
  factionIconPath: string | null
  rarityIconPath: string | null
  factionColor: string
  onClick: () => void
}

const CardListItem = memo(function CardListItem({ 
  card, 
  isSelected, 
  factionIconPath, 
  rarityIconPath, 
  factionColor,
  onClick 
}: CardListItemProps) {
  return (
    <div style={{ 
      // CSS containment for better performance - browser can skip rendering off-screen items
      contentVisibility: 'auto',
      containIntrinsicSize: '0 40px', // Approximate height for layout
    }}>
      <Button
        variant={isSelected ? 'filled' : 'subtle'}
        onClick={onClick}
        className="w-full h-auto"
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
}

export function DeckDetails({ deck, opened, onClose, onDeckClick, allDecks = [], parentFusedDeck }: DeckDetailsProps) {
  const [selectedCard, setSelectedCard] = useState<CardInfo | null>(null)
  const [selectedLevel, setSelectedLevel] = useState<number>(1) // Current card level (1, 2, or 3)
  const [cardImages, setCardImages] = useState<Record<string, Record<number, string>>>({}) // cardId -> level -> imageUrl
  const [loadingLevels, setLoadingLevels] = useState<Record<string, Record<number, boolean>>>({}) // cardId -> level -> loading
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())
  const [imageLoadStatus, setImageLoadStatus] = useState<Record<string, boolean>>({})
  const [fullDeckData, setFullDeckData] = useState<Deck | null>(null) // Full deck data with forgeborn.solbindCards
  const [fusedSourceDecks, setFusedSourceDecks] = useState<Deck[]>([])
  const [copied, setCopied] = useState(false)
  const levelManuallyChangedRef = useRef<boolean>(false)
  const lastSelectedCardIdRef = useRef<string | null>(null)
  const cardImagesRef = useRef<Record<string, Record<number, string>>>({})
  const loadingInFlightRef = useRef<Set<string>>(new Set())
  const imageRequestCacheRef = useRef<Map<string, Promise<string | null>>>(new Map())
  const fusedSourceDecksRef = useRef<string>('') // Track last merged source IDs to avoid re-setting state
  const fusedCardsMergedRef = useRef<boolean>(false) // Prevent repeated card merging for fused decks

  useEffect(() => {
    cardImagesRef.current = cardImages
  }, [cardImages])

  // Reset fused-specific caches when a different deck is opened
  useEffect(() => {
    fusedCardsMergedRef.current = false
    fusedSourceDecksRef.current = ''
    setFusedSourceDecks([])
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

  const loadImageOnce = useCallback((cardId: string, level: number, isForgeborn: boolean) => {
    const key = `${cardId}-${level}-${isForgeborn ? 'f' : 'r'}`
    const existing = imageRequestCacheRef.current.get(key)
    if (existing) return existing

    const promise = loadSingleImage(cardId, level, isForgeborn)
      .then((url) => {
        if (!url) {
          imageRequestCacheRef.current.delete(key)
        }
        return url
      })
      .catch((error) => {
        imageRequestCacheRef.current.delete(key)
        throw error
      })

    imageRequestCacheRef.current.set(key, promise)
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
    const deckWithData = fullDeckData || deck
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
          if (foundDeck1) {
            deck1 = foundDeck1
          } else {
            // Use myDeck1 directly as fallback
            deck1 = myDeck1 as Deck
          }
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
          if (foundDeck2) {
            deck2 = foundDeck2
          } else {
            // Use myDeck2 directly as fallback
            deck2 = myDeck2 as Deck
          }
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
  }, [deck, fullDeckData, allDecks, fusedSourceDecks])

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
    
    // If cached data belongs to a different deck, reset it
    if (fullDeckData && fullDeckData.id !== deck.id) {
      setFullDeckData(null)
    }
    
    // If we already loaded full data for this deck, do nothing
    if (fullDeckData && fullDeckData.id === deck.id) {
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
      setFullDeckData(deck)
      if (process.env.NODE_ENV === 'development') {
        logWithTimestamp('[DeckDetails] ✅ Deck already has forgeborn.solbindCards:', deckAny.forgeborn.solbindCards.length)
      }
    } else {
      // Fetch full deck details to get forgeborn.solbindCards
      if (process.env.NODE_ENV === 'development') {
        logWithTimestamp('[DeckDetails] 🔄 Fetching full deck data for:', deck.id)
      }
      
      fetchDeckDetails(deck.id).then((fullData) => {
        if (fullData) {
          // Merge forgeborn data with existing deck data
          const updatedDeck = {
            ...deck,
            forgeborn: fullData.forgeborn || deck.forgeborn,
            cards: fullData.cardList || fullData.cards || deck.cards,
            myDecks: (fullData as any).myDecks || (deck as any).myDecks,
            fusedDeckIds: (fullData as any).fusedDeckIds || (deck as any).fusedDeckIds
          } as Deck
          
          setFullDeckData(updatedDeck)
          
          if (process.env.NODE_ENV === 'development') {
            logWithTimestamp('[DeckDetails] ✅ Loaded full deck data:', {
              deckId: deck.id,
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
          
          if ((deck as any).format === 'Fused' && Array.isArray((fullData as any).myDecks)) {
            const newSources = (fullData as any).myDecks as Deck[]
            const ids = newSources
              .map((d, idx) => `${d?.id || `idx-${idx}`}:${Array.isArray(d?.cards) ? d.cards.length : 0}:${Array.isArray((d as any)?.cardList) ? (d as any).cardList.length : 0}`)
              .join('|')
            fusedSourceDecksRef.current = ids
            setFusedSourceDecks(newSources)
          }
        }
      }).catch((error) => {
        console.warn('[DeckDetails] ❌ Error loading full deck data:', error)
        // Fallback to existing deck data
        setFullDeckData(deck)
      })
    }
  }, [deck, opened, fullDeckData])

  // Log fused deck source decks data to server
  useEffect(() => {
    if (!deck || !opened) return
    
    const [deck1, deck2] = getFusedDeckSourceDecks
    const fusedDeckAny = deck as any
    
    const logData = {
      deckName: deck.name,
      deckId: deck.id,
      deckFormat: fusedDeckAny.format,
      hasMyDecks: !!(fusedDeckAny.myDecks),
      myDecksLength: Array.isArray(fusedDeckAny.myDecks) ? fusedDeckAny.myDecks.length : 0,
      myDecksData: Array.isArray(fusedDeckAny.myDecks) ? fusedDeckAny.myDecks.map((d: any) => ({
        id: d?.id,
        deckId: d?.deckId,
        name: d?.name,
        hasName: !!d?.name,
        hasId: !!d?.id,
        type: typeof d
      })) : null,
      hasFusedDeckIds: !!(fusedDeckAny.fusedDeckIds),
      fusedDeckIds: Array.isArray(fusedDeckAny.fusedDeckIds) ? fusedDeckAny.fusedDeckIds : null,
      allDecksCount: allDecks.length,
      allDecksIds: allDecks.map(d => d.id),
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
  }, [deck, opened, getFusedDeckSourceDecks, allDecks, onDeckClick])

  // Load source halves for fused decks when they lack card lists
  const isFusedDeck = (d: any) => {
    if (!d || !d.format) return false
    return String(d.format).toLowerCase().includes('fused')
  }

  useEffect(() => {
    if (!deck || !opened || !isFusedDeck(deck)) return
    const deckAny = (fullDeckData || deck) as any
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
  }, [deck, opened, fullDeckData, getFusedDeckSourceDecks, fusedSourceDecks])

  // If fused deck still has no cards but sources do, merge source cards into fullDeckData
  useEffect(() => {
    const deckToUse = fullDeckData || deck
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
    const mergedDeck = { ...(fullDeckData || deck), cards: combinedCards } as Deck
    setFullDeckData(mergedDeck)
  }, [deck, opened, fullDeckData, fusedSourceDecks, isFusedDeck])

  // Normalize cards with real names (memoized for stability)
  const normalizedCards: CardInfo[] = useMemo(() => {
    const deckToUse = fullDeckData || deck
    if (!deckToUse) return []

    const extractCardsFromDeck = (d: any): any[] => {
      if (!d) return []
      if (Array.isArray(d.cards)) return d.cards
      if (d.cards && typeof d.cards === 'object') return Object.values(d.cards)
      if (Array.isArray(d.cardList)) return d.cardList
      return []
    }

    // Collect cards from fused deck itself
    let rawCards: any[] = []
    if (Array.isArray(deckToUse.cards)) {
      rawCards = deckToUse.cards
    } else if (deckToUse.cards && typeof deckToUse.cards === 'object') {
      rawCards = Object.values(deckToUse.cards)
    } else if (Array.isArray((deckToUse as any).cardList)) {
      rawCards = (deckToUse as any).cardList
    }

    // For fused decks prefer exact halves (prevents overcount if fused record has extra entries)
    if (isFusedDeck(deckToUse)) {
      const [src1, src2] = getFusedDeckSourceDecks
      const sourceList = [src1, src2, ...fusedSourceDecks]
      const seen = new Set<string>()
      const combined: any[] = []

      const addCards = (cardsArr: any[]) => {
        cardsArr.forEach((c, idx) => {
          const key = c?.id || c?.cardId || c?.name || `card-${combined.length + idx}`
          if (seen.has(key)) return
          seen.add(key)
          combined.push(c)
        })
      }

      sourceList.forEach(src => {
        const extracted = extractCardsFromDeck(src)
        if (extracted.length > 0) addCards(extracted)
      })

      // If we got cards from halves, use them; otherwise fall back to fused record cards
      if (combined.length > 0) {
        rawCards = combined
      } else if (rawCards.length === 0) {
        // As a last resort, keep rawCards empty (handled below)
      }
    }

    if (rawCards.length === 0) return []
    
    const cards = rawCards.map((card: any, index: number) => {
      if (typeof card === 'string') {
        // If card is just a string ID, try to find full card data
        return getCardInfo(card)
      } else if (typeof card === 'object' && card !== null) {
        // Preserve full card object with all its data (cardType, rarity, etc.)
        const cardId = card.id || card.cardId || card.name || `card-${index}`
        const info = getCardInfo(cardId, card)
        // Make sure we keep embedded solbindCards (some helpers strip unknown props)
        if (card.solbindCards) {
          ;(info as any).solbindCards = card.solbindCards
        }
        return info
      }
      return getCardInfo(`card-${index}`)
    })
    
    return cards
  }, [deck, fullDeckData, getFusedDeckSourceDecks, fusedSourceDecks])

  // Deduplicate normalized cards by id (or name fallback) to avoid double counting
  const uniqueNormalizedCards: CardInfo[] = useMemo(() => {
    const map = new Map<string, CardInfo>()
    normalizedCards.forEach((card, idx) => {
      const key = (card as any)?.id || (card as any)?.cardId || card.name || `idx-${idx}`
      const existing = map.get(key)
      if (!existing) {
        map.set(key, card)
        return
      }

      // Prefer the richer object (e.g., with solbindCards) when duplicates collide
      const current = card as any
      const stored = existing as any

      const storedHasSolbind = Array.isArray(stored.solbindCards) && stored.solbindCards.length > 0
      const currentHasSolbind = Array.isArray(current.solbindCards) && current.solbindCards.length > 0

      // If the new card has solbind data and the stored one doesn't, replace
      if (currentHasSolbind && !storedHasSolbind) {
        map.set(key, card)
        return
      }

      // If both have solbindCards but the new one has more entries, merge them
      if (currentHasSolbind && storedHasSolbind) {
        const mergedIds = new Set<string>()
        const mergedList: any[] = []
        ;[...(stored.solbindCards as any[]), ...(current.solbindCards as any[])].forEach((c) => {
          const cid = c?.id || c?.cardId || c?.name
          const dedupKey = cid || JSON.stringify(c)
          if (dedupKey && mergedIds.has(dedupKey)) return
          mergedIds.add(dedupKey)
          mergedList.push(c)
        })
        const merged = { ...stored, solbindCards: mergedList }
        map.set(key, merged as CardInfo)
        return
      }

      // Otherwise keep the first occurrence
    })
    return Array.from(map.values())
  }, [normalizedCards])

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

  // First, extract all solbind card IDs to avoid circular dependency
  // Use a stable string representation for dependencies
  const solbindCardIdsSet = useMemo(() => {
    const deckToUse = fullDeckData || deck
    if (!deckToUse) return new Set<string>()
    const ids = new Set<string>()
    
    // First, check forgeborn.solbindCards for Solbind cards
    if (deckToUse.forgeborn && typeof deckToUse.forgeborn === 'object' && deckToUse.forgeborn.solbindCards && Array.isArray(deckToUse.forgeborn.solbindCards)) {
      deckToUse.forgeborn.solbindCards.forEach((solbindCard: any) => {
        if (solbindCard && solbindCard.id) {
          // Only add if it's actually a Solbind card (rarity === 'Solbind')
          // Second forgeborn (e.g., "Blighted Ironbeard") is not a Solbind card
          const isSolbindCard = solbindCard.rarity === 'Solbind' || solbindCard.rarity === 'solbind'
          if (isSolbindCard) {
            ids.add(solbindCard.id)
          }
        }
      })
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
    
    // Also add cards that have rarity === 'Solbind' directly in normalizedCards
    uniqueNormalizedCards.forEach(card => {
      const cardData = card as any
      // Skip if this card has solbindCards (it's the parent, not the solbind itself)
      if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
        return
      }
      // Add if rarity is Solbind
      if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
        ids.add(card.id)
      }
    })
    
    if (process.env.NODE_ENV === 'development' && ids.size > 0) {
      // logWithTimestamp(`[DeckDetails] Solbind card IDs:`, Array.from(ids))
    }
    
    return ids
  }, [uniqueNormalizedCards, deck, fullDeckData])
  
  // Create a stable string representation for use in dependencies
  const solbindCardIdsKey = useMemo(() => {
    return Array.from(solbindCardIdsSet).sort().join(',')
  }, [solbindCardIdsSet])

  // Rarity summary (including Solbind) for badges in header
  const raritySummary = useMemo(() => {
    const summary = new Map<string, number>()

    const add = (key: string) => summary.set(key, (summary.get(key) || 0) + 1)

    const solbindIds = solbindCardIdsSet

    uniqueNormalizedCards.forEach((card, idx) => {
      const cardData = card as any

      // Skip parent Solbind cards (they are containers)
      const isParentSolbind = cardData.solbindCards && Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0
      if (isParentSolbind) return

      const cardId = card.id || cardData.cardId || `card-${idx}`
      const rarityRaw = cardData.rarity

      // Solbind check
      const isSolbind =
        solbindIds.has(cardId) ||
        (typeof rarityRaw === 'string' && rarityRaw.toLowerCase().includes('solbind'))
      if (isSolbind) {
        add('Solbind')
        return
      }

      if (typeof rarityRaw === 'string') {
        let normalizedRarity = rarityRaw.trim()
        const lower = normalizedRarity.toLowerCase()

        if (lower.includes('common') && lower.includes('rare')) {
          normalizedRarity = 'Common Rare'
        } else if (lower.includes('rare') && !lower.includes('common')) {
          normalizedRarity = 'Rare'
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

  // Load images only for the selected card (lazy loading for performance)
  useEffect(() => {
    if (!opened || !selectedCard) return

    let isCanceled = false
    
    const loadSelectedCardImages = async () => {
      const cardData = selectedCard as any
      const isForgeborn = deck?.forgebornId === selectedCard.id || 
                         selectedCard.id === deck?.forgebornId ||
                         selectedCard.type?.toLowerCase().includes('forgeborn') ||
                         cardData.cardType?.toLowerCase().includes('forgeborn')
      
      const existingImages = cardImages[selectedCard.id] || {}
      const levelsToLoad = isForgeborn
        ? [1].filter(level => !existingImages[level] && !isInFlight(selectedCard.id, level))
        : [1, 2, 3].filter(level => !existingImages[level] && !isInFlight(selectedCard.id, level))
      
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
  }, [opened, selectedCard, deck?.forgebornId, cardImages, markLevelsLoading, markLevelDone, isInFlight, startInFlight, finishInFlight, loadImageOnce])

  // Background preload all card images (delayed to not block UI)
  useEffect(() => {
    if (!opened || normalizedCards.length === 0) return
    
    let isCanceled = false
    
    const loadAllLevelOnesAndSolbind = async () => {
      for (const card of normalizedCards) {
        if (isCanceled) break

        const cardData = card as any
        const isForgeborn = deck?.forgebornId === card.id || 
                           card.id === deck?.forgebornId ||
                           card.type?.toLowerCase().includes('forgeborn') ||
                           cardData.cardType?.toLowerCase().includes('forgeborn')
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
  }, [opened, normalizedCards, deck?.forgebornId, markLevelsLoading, markLevelDone, solbindCardIdsSet, isInFlight, startInFlight, finishInFlight, loadImageOnce])

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
      const deckForUse = fullDeckData || deck

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
    const deckForUse = fullDeckData || deck
    if (!deckForUse) return []
    
    const forgebornList: CardInfo[] = []

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
            const isForgebornCard = cardType && typeof cardType === 'string' && cardType.toLowerCase().includes('forgeborn')
            
            // Also check rarity - if it's NOT Solbind and has Forgeborn type, it's a second forgeborn
            const rarity = solbindCard.rarity || solbindCard.Rarity || ''
            const isNotSolbind = !rarity || (typeof rarity === 'string' && !rarity.toLowerCase().includes('solbind'))
            
            if (process.env.NODE_ENV === 'development') {
              // Debug logging disabled for performance
              // logWithTimestamp(`[DeckDetails] Checking solbindCard...`)
            }
            
            if (isForgebornCard && isNotSolbind) {
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
      return [forgebornByType]
    }
    
    return []
  }, [normalizedCards, deck, fullDeckData, getFusedDeckSourceDecks])

  const solbindCards: CardInfo[] = useMemo(() => {
    const deckForUse = fullDeckData || deck
    if (!deckForUse) return []
    
    // Extract Solbind cards from solbindCards arrays in other cards
    const solbindCardObjects: CardInfo[] = []
    const parentSolbindIds = new Set<string>()
    
    // First, check forgeborn.solbindCards (solbind cards attached to forgeborn)
    if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.solbindCards && Array.isArray(deckForUse.forgeborn.solbindCards)) {
      deckForUse.forgeborn.solbindCards.forEach((solbindCard: any) => {
        if (solbindCard && solbindCard.id) {
          // Only add if it's actually a Solbind card (rarity === 'Solbind')
          // Second forgeborn (e.g., "Blighted Ironbeard") is not a Solbind card
          const isSolbindCard = solbindCard.rarity === 'Solbind' || solbindCard.rarity === 'solbind'
          if (isSolbindCard && !solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
            solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
            if (process.env.NODE_ENV === 'development') {
              // logWithTimestamp(`[DeckDetails] ✅ Added Solbind card...`)
            }
          }
        }
      })
    }
    
    // Second, find all cards that have solbindCards array and extract those cards
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

      const hasSolbindChildren =
        solbindList.length > 0 ||
        !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)

      if (hasSolbindChildren && card.id) parentSolbindIds.add(card.id)

      solbindList.forEach((solbindCard: any) => {
        if (solbindCard && solbindCard.id) {
          // Create CardInfo from solbind card data
          if (!solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
            solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
          }
        }
      })

      // Also add by solbindId1/solbindId2 if provided
      const id1 = cardData.solbindId1 || cardData.solbindid1
      const id2 = cardData.solbindId2 || cardData.solbindid2
      ;[id1, id2].forEach(id => {
        if (id && !solbindCardObjects.some(sb => sb.id === id)) {
          solbindCardObjects.push(getCardInfo(id))
        }
      })
    })
    
    // Also check for cards in normalizedCards that are solbind cards
    uniqueNormalizedCards.forEach(card => {
      if (forgebornCards.includes(card)) return
      
      const cardData = card as any
      const cardId = card.id
      const hasSolbindChildren =
        (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
        !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)
      
      // Skip if this card has solbindCards (it's the parent, not the solbind itself)
      if (hasSolbindChildren) {
        return
      }
      
      // Check if this card is in any solbindCards array (already added above)
      if (solbindCardIdsSet.has(cardId)) {
        // Check if it's already in solbindCardObjects
        if (!solbindCardObjects.some(sb => sb.id === cardId)) {
          solbindCardObjects.push(card)
        }
        return
      }
      
      // Check if rarity is Solbind and it's not a parent card
      // Count ALL cards with Solbind rarity, not just specific names
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
    
    // Deduplicate by id to be safe
    const dedupMap = new Map<string, CardInfo>()
    solbindCardObjects.forEach((sb, idx) => {
      const key = sb.id || sb.cardId || sb.name || `solbind-${idx}`
      if (!dedupMap.has(key)) {
        dedupMap.set(key, { ...sb, id: sb.id || key })
      }
    })
    
    return Array.from(dedupMap.values())
  }, [uniqueNormalizedCards, forgebornCards, solbindCardIdsSet, deck, fullDeckData])

  // Merge rarity summary with Solbind count (make sure Solbind shows up if we have Solbind cards)
  const displayRaritySummary = useMemo(() => {
    const summary = new Map(raritySummary)
    // Safety net: if solbindCards somehow misses items, also use the size of the ID set
    const solbindCount = Math.max(solbindCards.length, solbindCardIdsSet.size)
    if (solbindCount > 0) {
      const existing = summary.get('Solbind') || 0
      const finalCount = Math.max(existing, solbindCount)
      summary.set('Solbind', finalCount)
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
    if (alreadyLoaded || isInFlight(firstForgeborn.id, 1)) return

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

  const spellCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    return uniqueNormalizedCards.filter(card => {
      if (forgebornCards.includes(card)) return false
      
      const cardData = card as any
      const name = card.name?.toLowerCase() || ''
      
      // Use ONLY cardType to determine if spell
      const cardType = cardData.cardType || cardData.card_type || ''
      const lowerCardType = cardType.toLowerCase()
      return lowerCardType.includes('spell') && !lowerCardType.includes('creature')
    })
  }, [uniqueNormalizedCards, forgebornCards, solbindCardIdsSet, deck])

  const creatureCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    // Create sets of IDs for faster lookup
    const forgebornIds = new Set(forgebornCards.map(fb => fb.id).filter(Boolean))
    const spellIds = new Set(spellCards.map(sp => sp.id).filter(Boolean))
    const solbindIds = new Set(solbindCards.map(sb => sb.id).filter(Boolean))
    
    return uniqueNormalizedCards.filter(card => {
      if (!card.id) return false
      const cardData = card as any
      const cardTypeLower = (cardData.cardType || cardData.type || '').toLowerCase()
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
  }, [uniqueNormalizedCards, forgebornCards, spellCards, solbindCards, deck])

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
  // Helper function to check if a card is from B1 set
  const isB1Card = useCallback((card: CardInfo | any): boolean => {
    if (!card) return false
    
    const cardData = card as any
    const cardSetId = cardData.cardSetId || cardData.CardSetId || cardData.SK || cardData.sk
    const cardId = card.id || cardData.id || cardData.cardId || cardData.name
    
    // Check cardSetId/SK for B1
    if (cardSetId && String(cardSetId).toLowerCase() === 'b1') {
      return true
    }
    
    // Check cardId for b1_ prefix
    if (cardId && /^b1_/i.test(cardId)) {
      return true
    }
    
    return false
  }, [])

  // Helper function to determine deck set: if any card is from B1, return "B1", otherwise use deck.cardSetNo
  const getDeckSet = useCallback((deck: Deck | null, normalizedCards: CardInfo[]): string | null => {
    if (!deck) return null
    
    const deckAny = deck as any
    
    // For fused decks, check cards from source decks (myDecks) if normalizedCards is empty
    if (deckAny.format === 'Fused' && normalizedCards.length === 0) {
      // Check source decks (myDecks) for B1 cards
      if (deckAny.myDecks && Array.isArray(deckAny.myDecks)) {
        for (const sourceDeck of deckAny.myDecks) {
          if (sourceDeck && sourceDeck.cards && Array.isArray(sourceDeck.cards)) {
            const hasB1Card = sourceDeck.cards.some((card: any) => {
              // Handle string cards
              if (typeof card === 'string') {
                return /^b1_/i.test(card)
              }
              // Handle object cards
              if (typeof card === 'object' && card !== null) {
                const cardSetId = card.cardSetId || card.CardSetId || card.SK || card.sk
                const cardId = card.id || card.cardId || card.name
                if (cardSetId && String(cardSetId).toLowerCase() === 'b1') return true
                if (cardId && /^b1_/i.test(cardId)) return true
              }
              return false
            })
            if (hasB1Card) {
              return 'B1'
            }
          }
        }
      }
      
      // If no B1 cards found in source decks, return null (fused decks don't have cardSetNo)
      return null
    }
    
    // Check if any card in normalizedCards is from B1 set
    const hasB1Card = normalizedCards.some(card => isB1Card(card))
    
    if (hasB1Card) {
      return 'B1'
    }
    
    // Otherwise use deck.cardSetNo
    return deck.cardSetNo || null
  }, [isB1Card])

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
  
  // Helper function to format set name: "1" -> "S1", "2" -> "S2", "B1" -> "B1", etc.
  const formatSetName = useCallback((setNo: string | number | null | undefined): string | null => {
    if (!setNo) return null
    
    const setStr = String(setNo).trim()
    
    // If it's already B1 or b1, return as B1
    if (setStr.toUpperCase() === 'B1' || setStr.toLowerCase() === 'b1') {
      return 'B1'
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
      // SK might be in format like "b1" or "s3", normalize it
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
      // Check for b1_ prefix first
      if (/^b1_/i.test(cardId)) {
        cardSet = 'b1'
      } else {
        // Extract set number from cardId (e.g., "s3nn1arrogant-butcher" -> "3")
        const match = cardId.match(/^s(\d+)/i)
        if (match && match[1]) {
          cardSet = `s${match[1]}`
        }
      }
    }
    
    // Check if this is B1 set (Betrayer set)
    // B1 can be identified by cardSet being "B1" or "b1", or by cardId starting with "b1_"
    const isB1Set = 
      (cardSet && (cardSet.toUpperCase() === 'B1' || cardSet === 'b1')) ||
      (cardId && /^b1_/i.test(cardId))
    
    if (isB1Set) {
      // Return B1 rarity icons (b1_*.png -> B1_*.png)
      return `/images/icons/rarity/B1_${normalizedRarity}.png`
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
    return `/images/icons/rarity/S${setNo}_${normalizedRarity}.png`
  }, [])

  // Determine deck set (B1 if any card is from B1, otherwise deck.cardSetNo)
  const deckSet = useMemo(() => {
    if (!deck) return null
    return getDeckSet(deck, normalizedCards)
  }, [deck, normalizedCards, getDeckSet])
  
  const formattedDeckSet = useMemo(() => {
    return formatSetName(deckSet)
  }, [deckSet, formatSetName])

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
    
    return {
      factionIconPath: faction ? `/images/icons/${faction}.png` : null,
      rarityIconPath: isForgeborn ? null : getRarityIconPath(deck.cardSetNo, rarity, card.id, cardData),
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
        <Group justify="space-between" className="w-full" wrap="nowrap">
          <Group gap="md" wrap="nowrap" className="flex-1 min-w-0">
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
            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
                  style={{ flexShrink: 0, margin: 0, textDecoration: copied ? 'underline' : 'none' }}
                >
                  {deck.name || 'Untitled Deck'}
                </Title>
              </button>
              {/* Don't show faction/set badges for fused decks */}
              {formattedDeckSet && deck.format !== 'Fused' && (
                <Group gap={4} wrap="nowrap">
                  {deck.faction && (
                    <Image
                      src={`/images/icons/${deck.faction.toLowerCase()}.png`}
                      alt={deck.faction}
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
                const d = deck as any
                const ownerName = d.username || d.playerName || null
                if (!ownerName) return null
                const expireAt =
                  d.expireAt ||
                  d.expire ||
                  d.expireDate ||
                  d.expire_date ||
                  d.expiry ||
                  d.pExpiry ||
                  null
                const expireLabel =
                  expireAt &&
                  new Date(expireAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                const expireTs = expireAt ? Date.parse(expireAt) : NaN
                const hasExpire = Number.isFinite(expireTs)
                const isExpired = hasExpire ? expireTs < Date.now() : false

                return (
                  <Group gap="xs" wrap="wrap">
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
                        Expire: {expireLabel}
                      </Badge>
                    )}
                  </Group>
                )
              })()}
            </Group>
            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {deck.deckRank && (
              <Badge
                color={deck.deckRank === 'Unranked' ? 'gray' : 'blue'}
                variant="light"
                size="sm"
              >
                {deck.deckRank}
              </Badge>
            )}
            {deck.format && (
                <Badge
                  color="gray"
                  variant="light"
                  size="sm"
                >
                {deck.format}
                </Badge>
              )}
            </Group>
            {deck && (() => {
              const isFused = deck.format === 'Fused' || (deck as any).format === 'Fused'
              const solforgefusionUrl = isFused 
                ? `https://solforgefusion.com/fused/${deck.id}`
                : `https://solforgefusion.com/decks/${deck.id}`
              
              return (
                <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
          })()}
            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
              {(deck as any).deckScore !== undefined && (deck as any).deckScore !== null && (
                <Badge
                  color="grape"
                  variant="light"
                  size="sm"
                >
                  Score: {typeof (deck as any).deckScore === 'number' ? Math.round((deck as any).deckScore * 100) : (deck as any).deckScore}
                </Badge>
              )}
              {(deck as any).elo !== undefined && (deck as any).elo !== null && (
                <Badge
                  color="violet"
                  variant="light"
                  size="sm"
                >
                  ELO: {typeof (deck as any).elo === 'number' ? Math.round((deck as any).elo) : (deck as any).elo}
                </Badge>
              )}
            </Group>
            {(() => {
              const [sourceDeck1, sourceDeck2] = getFusedDeckSourceDecks
              const sourceDeck1Set = formatSetName(getDeckSetForDeck(sourceDeck1))
              const sourceDeck2Set = formatSetName(getDeckSetForDeck(sourceDeck2))
              
              if (sourceDeck1 || sourceDeck2) {
                return (
                  <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
                                    <Group gap={6} wrap="nowrap">
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
                                    <Group gap={6} wrap="nowrap">
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
          width: 'min(1500px, calc(100vw - 64px))',
          minWidth: 'min(1100px, calc(100vw - 64px))',
          minHeight: '80vh',
          transition: 'transform 300ms ease-in-out, opacity 300ms ease-in-out',
        },
        header: {
          backgroundColor: 'rgba(30, 41, 59, 0.98)',
          borderBottom: '1px solid rgba(74, 144, 226, 0.2)',
        },
        body: {
          padding: '1.5rem',
          maxHeight: '80vh',
          minHeight: '70vh',
          overflowY: 'auto',
        },
        overlay: {
          transition: 'opacity 300ms ease-in-out, backdrop-filter 300ms ease-in-out',
        },
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Left column - card lists */}
        <div className="lg:col-span-1 flex flex-col h-full">
          <ScrollArea className="flex-1" style={{ padding: 0, maxHeight: '70vh' }}>
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
                      return (
                        <CardListItem
                          key={`forgeborn-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
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
                      return (
                        <CardListItem
                          key={`creature-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
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
                      return (
                        <CardListItem
                          key={`spell-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
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
                      return (
                        <CardListItem
                          key={`solbind-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
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
                      return (
                        <CardListItem
                          key={`card-${card.id}-${index}`}
                          card={card}
                          isSelected={selectedCard?.id === card.id}
                          factionIconPath={props.factionIconPath}
                          rarityIconPath={props.rarityIconPath}
                          factionColor={props.factionColor}
                          onClick={() => handleSelectCard(card)}
                        />
                      )
                    })}
                  </Stack>
                </div>
              )}
            </Stack>
          </ScrollArea>
        </div>

        {/* Right column - detailed card information */}
        <div
          className="lg:col-span-2 flex flex-col h-full"
          style={{ position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: '70vh' }}
        >
          {selectedCard ? (
            <Stack gap="lg">
              {/* Card image */}
              <Paper
                p="xl"
                className="backdrop-blur-md border border-sf-primary/30 rounded-lg"
                style={{ 
                  backgroundColor: 'rgba(30, 41, 59, 0.6)',
                  minHeight: '400px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                <div className="text-center w-full">
                  {(() => {
                    const cardImageData = cardImages[selectedCard.id]
                    const currentImageUrl = cardImageData?.[selectedLevel]

                    const levelErrorKey = `${selectedCard.id}-${selectedLevel}`
                    const hasError = imageErrors.has(levelErrorKey)

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
                    
                    const effectiveLevel = selectedLevel
                    const effectiveImageUrl = currentImageUrl
                    
                    const availableLevels = cardImageData ? Object.keys(cardImageData).map(Number).sort() : []
                    const hasAllLevels = availableLevels.length === 3 && availableLevels.includes(1) && availableLevels.includes(2) && availableLevels.includes(3)
                    const shouldEnableMouseScroll = !isForgeborn && hasAllLevels
                    
                    const imageWidth = isForgeborn ? 400 : 300
                    const imageHeight = isForgeborn ? 600 : 450
                    const aspectRatio = '2 / 3'

                    const imageKey = effectiveImageUrl ? `${selectedCard.id}-${effectiveLevel}-${effectiveImageUrl}` : ''
                    const isImageReady = !!(imageKey && imageLoadStatus[imageKey])

                    return !hasError ? (
                      <div className="relative w-full flex flex-col items-center justify-center gap-4">
                        <div
                          className="relative w-full flex items-center justify-center"
                          style={{
                            maxWidth: `${imageWidth}px`,
                            aspectRatio,
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
                              sizes="(max-width: 1024px) 80vw, 400px"
                              style={{
                                transform: isForgeborn ? 'rotate(-90deg)' : 'none',
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
                                borderColor: getFactionBadgeColor(selectedCard.faction || deck.faction),
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
                          <Group gap="xs" justify="center">
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
                          borderColor: getFactionBadgeColor(selectedCard.faction || deck.faction),
                        }}
                      >
                        <Text size="lg" className="text-white text-center px-4">
                          {selectedCard.name}
                        </Text>
                      </div>
                    )
                  })()}
                  </div>
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
      </div>
    </Modal>
  )
}
