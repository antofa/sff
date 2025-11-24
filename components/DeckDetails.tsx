'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Modal, Stack, Paper, Title, Text, Group, Badge, Button, ScrollArea, Divider, Image, Loader } from '@mantine/core'
import { IconHandFinger, IconCalendar, IconExternalLink, IconWorld } from '@tabler/icons-react'
import type { Deck } from '@/store/deckStore'
import { formatCardName, getCardImageUrl, getCardImageUrls, getCardInfo, getForgebornAlternativeUrl, type CardInfo } from '@/lib/api'

// Fetch full deck details from API
async function fetchDeckDetails(deckId: string): Promise<any> {
  try {
    const url = `https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/deck/${deckId}?inclCards=true&inclUsers=true`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SolForge-Fusion-Deck-Viewer/1.0',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      console.warn(`[DeckDetails] Failed to fetch deck details for ${deckId}: ${response.status}`)
      return null
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.warn(`[DeckDetails] Error fetching deck details for ${deckId}:`, error)
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

interface DeckDetailsProps {
  deck: Deck | null
  opened: boolean
  onClose: () => void
  onDeckClick?: (deck: Deck, parentDeck?: Deck | null) => void
  allDecks?: Deck[]
  parentFusedDeck?: Deck | null
}

export function DeckDetails({ deck, opened, onClose, onDeckClick, allDecks = [], parentFusedDeck }: DeckDetailsProps) {
  const [selectedCard, setSelectedCard] = useState<CardInfo | null>(null)
  const [selectedLevel, setSelectedLevel] = useState<number>(1) // Current card level (1, 2, or 3)
  const [cardImages, setCardImages] = useState<Record<string, Record<number, string>>>({}) // cardId -> level -> imageUrl
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())
  const [fullDeckData, setFullDeckData] = useState<Deck | null>(null) // Full deck data with forgeborn.solbindCards

  // Helper function to get two source decks from fused deck
  const getFusedDeckSourceDecks = useMemo(() => {
    if (!deck) return [null, null]
    
    const fusedDeckAny = deck as any
    
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
    
    return [deck1, deck2]
  }, [deck, allDecks])

  // Load full deck data when modal opens to get forgeborn.solbindCards
  useEffect(() => {
    if (!deck || !opened || !deck.id) {
      // Reset fullDeckData when modal closes or deck is null
      setFullDeckData(null)
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
        console.log('[DeckDetails] ✅ Deck already has forgeborn.solbindCards:', deckAny.forgeborn.solbindCards.length)
      }
    } else {
      // Fetch full deck details to get forgeborn.solbindCards
      if (process.env.NODE_ENV === 'development') {
        console.log('[DeckDetails] 🔄 Fetching full deck data for:', deck.id)
      }
      
      fetchDeckDetails(deck.id).then((fullData) => {
        if (fullData) {
          // Merge forgeborn data with existing deck data
          const updatedDeck = {
            ...deck,
            forgeborn: fullData.forgeborn || deck.forgeborn,
            cards: fullData.cardList || fullData.cards || deck.cards
          } as Deck
          
          setFullDeckData(updatedDeck)
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[DeckDetails] ✅ Loaded full deck data:', {
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
        }
      }).catch((error) => {
        console.warn('[DeckDetails] ❌ Error loading full deck data:', error)
        // Fallback to existing deck data
        setFullDeckData(deck)
      })
    }
  }, [deck?.id, opened])

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
      hasOnDeckClick: !!onDeckClick
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

  // Normalize cards with real names (memoized for stability)
  const normalizedCards: CardInfo[] = useMemo(() => {
    const deckToUse = fullDeckData || deck
    if (!deckToUse || !deckToUse.cards || !Array.isArray(deckToUse.cards)) return []
    
    const cards = deckToUse.cards.map((card: any, index: number) => {
      if (typeof card === 'string') {
        // If card is just a string ID, try to find full card data
        return getCardInfo(card)
      } else if (typeof card === 'object' && card !== null) {
        // Preserve full card object with all its data (cardType, rarity, etc.)
        const cardId = card.id || card.cardId || card.name || `card-${index}`
        return getCardInfo(cardId, card)
      }
      return getCardInfo(`card-${index}`)
    })
    
    // Log card types for debugging
    if (process.env.NODE_ENV === 'development' && cards.length > 0) {
      console.log('[DeckDetails] Card types:', cards.map(c => ({ 
        id: c.id, 
        name: c.name, 
        type: c.type,
        rarity: (c as any).rarity,
        cardType: (c as any).cardType
      })))
    }
    
    return cards
  }, [deck?.id, deck?.cards, fullDeckData])

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
    
    // Add Solbind cards from solbindCards arrays in normalizedCards
    normalizedCards.forEach(card => {
      const cardData = card as any
      if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
        cardData.solbindCards.forEach((solbindCard: any) => {
          if (solbindCard && solbindCard.id) {
            ids.add(solbindCard.id)
          }
        })
      }
    })
    
    // Also add cards that have rarity === 'Solbind' directly in normalizedCards
    normalizedCards.forEach(card => {
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
      console.log(`[DeckDetails] Solbind card IDs:`, Array.from(ids))
    }
    
    return ids
  }, [normalizedCards, deck, fullDeckData])
  
  // Create a stable string representation for use in dependencies
  const solbindCardIdsKey = useMemo(() => {
    return Array.from(solbindCardIdsSet).sort().join(',')
  }, [solbindCardIdsSet])

  // Helper function to load a single image
  const loadSingleImage = async (cardId: string, level: number, isForgeborn: boolean): Promise<string | null> => {
    return new Promise((resolve) => {
      const imageUrl = getCardImageUrl(cardId, level, isForgeborn)
      const img = new window.Image()
      const isSet99 = /^s99/i.test(cardId)
      
      const tryAlternativeUrl = (): void => {
        // For set 99 cards, try alternative paths
        if (isSet99 && !isForgeborn) {
          const baseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards'
          // Try non-resized path for set 99
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
            // Try with URL-encoded original ID for set 99
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
        
        // If original URL failed and this is forgeborn with dash, try alternative with space
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
        
        const promise = loadSingleImage(task.cardId, task.level, task.isForgeborn)
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

  // Load card images in specific order: Forgeborn -> Creatures/Spells Level 1 -> Level 2 -> Level 3 -> Solbind
  useEffect(() => {
    if (!opened || normalizedCards.length === 0) return

    // Track if the modal is still open to prevent state updates after closing
    let isModalOpen = true

    const loadImages = async () => {
      const errors = new Set<string>()
      
      // Helper function to update state immediately when an image loads
      // Only updates if modal is still open
      const updateImageState = (cardId: string, level: number, imageUrl: string) => {
        if (!isModalOpen) {
          console.log(`[DeckDetails] ⏹️ Skipping image update for ${cardId} - modal closed`)
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
        console.log(`[DeckDetails] ⏹️ Modal closed before image loading started`)
        return
      }

      // Use full deck data if available
      const deckForUse = fullDeckData || deck

      // Categorize cards (we need to compute these here since useMemo hooks are defined later)
      const forgebornCardsList: CardInfo[] = []
      const creatureCardsList: CardInfo[] = []
      const spellCardsList: CardInfo[] = []
      const solbindCardsList: CardInfo[] = []

      // First, identify Forgeborn
      if (deckForUse?.forgebornId) {
        const forgeborn = normalizedCards.find(card => 
          card.id === deckForUse.forgebornId || 
          (card.id && deckForUse.forgebornId && card.id.includes(deckForUse.forgebornId)) ||
          (deckForUse.forgebornId && card.id && deckForUse.forgebornId.includes(card.id))
        )
        if (forgeborn) {
          forgebornCardsList.push(forgeborn)
        } else if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
          // If forgeborn not found in normalizedCards, try to get it from deckForUse.forgeborn object
          const forgebornId = deckForUse.forgeborn.id || deckForUse.forgebornId
          const forgebornFromObject = getCardInfo(forgebornId, deckForUse.forgeborn)
          if (forgebornFromObject && !forgebornCardsList.some(fb => fb.id === forgebornFromObject.id)) {
            forgebornCardsList.push(forgebornFromObject)
          }
        }
      } else if (deckForUse?.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
        // If no forgebornId but we have forgeborn object, use it
        const forgebornFromObject = getCardInfo(deckForUse.forgeborn.id, deckForUse.forgeborn)
        if (forgebornFromObject && !forgebornCardsList.some(fb => fb.id === forgebornFromObject.id)) {
          forgebornCardsList.push(forgebornFromObject)
        }
      }
      
      // For fused decks, ensure first forgeborn is found from first source deck
      // This is important because first forgeborn might not be in normalizedCards
      if (deckForUse?.format === 'Fused') {
        const [deck1, deck2] = getFusedDeckSourceDecks
        const fusedDeckAny = deckForUse as any
        
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
        // Check if first forgeborn is already in the list by ID match
        const firstForgebornAlreadyInList = firstForgebornId && forgebornCardsList.some(fb => 
          fb.id === firstForgebornId || 
          (fb.id && firstForgebornId && fb.id.includes(firstForgebornId)) ||
          (firstForgebornId && fb.id && firstForgebornId.includes(fb.id))
        )
        
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
            console.log(`[DeckDetails] 🔥 Found first forgeborn for fused deck: ${firstForgeborn.id} (${firstForgeborn.name})`)
            forgebornCardsList.push(firstForgeborn)
          } else {
            console.log(`[DeckDetails] ⚠️ First forgeborn not found for fused deck with ID: ${firstForgebornId}`)
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
            !forgebornCardsList.some(fb => fb.id === card.id)
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
          
          if (secondForgeborn && !forgebornCardsList.some(fb => fb.id === secondForgeborn!.id)) {
            forgebornCardsList.push(secondForgeborn)
          }
        }
      }
      
      if (forgebornCardsList.length === 0) {
        const forgebornByType = normalizedCards.find(card =>
          card.type?.toLowerCase().includes('forgeborn') ||
          (card as any).cardType?.toLowerCase().includes('forgeborn')
        )
        if (forgebornByType) {
          forgebornCardsList.push(forgebornByType)
        }
      }

      // Categorize remaining cards
      normalizedCards.forEach(card => {
        if (forgebornCardsList.includes(card)) return
        
        const cardData = card as any
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
              const alreadyInList = forgebornCardsList.some(fb => 
                fb.id === solbindCard.id || 
                (fb.id && solbindCard.id && fb.id.includes(solbindCard.id)) ||
                (solbindCard.id && fb.id && solbindCard.id.includes(fb.id))
              )
              
              if (!alreadyInList) {
                const secondForgeborn = getCardInfo(solbindCard.id, solbindCard)
                forgebornCardsList.push(secondForgeborn)
                if (process.env.NODE_ENV === 'development') {
                  console.log(`[DeckDetails] ✅ Added second forgeborn to image loading list: ${secondForgeborn.name} (${secondForgeborn.id})`)
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

      console.log(`[DeckDetails] 📋 Image loading order: Forgeborn(${forgebornCardsList.length}) -> Creatures(${creatureCardsList.length})/Spells(${spellCardsList.length}) L1 -> L2 -> L3 -> Solbind(${solbindCardsList.length})`)

      // 1. Load Forgeborn first
      for (const card of forgebornCardsList) {
        if (!isModalOpen) {
          console.log(`[DeckDetails] ⏹️ Stopping Forgeborn loading - modal closed`)
          break
        }
        
        if (cardImages[card.id] && Object.keys(cardImages[card.id]).length > 0) {
          console.log(`[DeckDetails] Skipping Forgeborn ${card.id} - already loaded`)
          continue
        }

        console.log(`[DeckDetails] 🔥 [1/5] Loading Forgeborn: ${card.id} (${card.name})`)
        const imageUrl = await loadSingleImage(card.id, 1, true)
        
        if (process.env.NODE_ENV === 'development') {
          if (imageUrl) {
            console.log(`[DeckDetails] ✅ Forgeborn image loaded: ${card.name} (${card.id}) -> ${imageUrl}`)
          } else {
            console.warn(`[DeckDetails] ⚠️ Forgeborn image failed to load: ${card.name} (${card.id})`)
          }
        }
        
        if (!isModalOpen) {
          console.log(`[DeckDetails] ⏹️ Stopping after Forgeborn load - modal closed`)
          break
        }
        
        if (imageUrl) {
          // Update state immediately for all three levels
          updateImageState(card.id, 1, imageUrl)
          updateImageState(card.id, 2, imageUrl)
          updateImageState(card.id, 3, imageUrl)
          console.log(`[DeckDetails] ✅ Forgeborn loaded: ${card.id}`)
        } else {
          errors.add(card.id)
          console.warn(`[DeckDetails] ⚠️ Forgeborn failed: ${card.id}`)
        }
      }

      // 2-4. Load Creatures and Spells by level (all level 1 first, then all level 2, then all level 3)
      const regularCards = [...creatureCardsList, ...spellCardsList]
      
      for (let level = 1; level <= 3; level++) {
        if (!isModalOpen) {
          console.log(`[DeckDetails] ⏹️ Stopping Creatures/Spells loading at level ${level} - modal closed`)
          break
        }
        
        console.log(`[DeckDetails] 📦 [${level + 1}/5] Loading all Creatures/Spells Level ${level} in parallel (10 threads)...`)
        
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
                console.log(`[DeckDetails] ✅ Level ${level} loaded: ${cardId} (${task?.cardName || 'unknown'})`)
              }
            },
            () => !isModalOpen
          )
        }
      }

      // 5. Load Solbind last
      if (!isModalOpen) {
        console.log(`[DeckDetails] ⏹️ Skipping Solbind loading - modal closed`)
        return
      }
      
      console.log(`[DeckDetails] 🔷 [5/5] Loading Solbind cards in parallel (10 threads)...`)
      
      // Prepare tasks for Solbind cards (all levels for each card)
      const solbindTasks: Array<{ cardId: string; level: number; isForgeborn: boolean; cardName: string }> = []
      
      for (const card of solbindCardsList) {
        if (cardImages[card.id] && Object.keys(cardImages[card.id]).length > 0) {
          console.log(`[DeckDetails] Skipping Solbind ${card.id} - already loaded`)
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
            console.log(`[DeckDetails] ✅ Solbind loaded: ${card.id} (${card.name}) - ${loaded.size} levels`)
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
      console.log(`[DeckDetails] 🧹 Cleanup: stopped image loading for deck ${deck?.id}`)
    }
  }, [opened, normalizedCards.length, deck?.id, solbindCardIdsKey, getFusedDeckSourceDecks, deck]) // Include getFusedDeckSourceDecks for fused deck second forgeborn

  // Group cards by categories - must be before any conditional returns
  const forgebornCards: CardInfo[] = useMemo(() => {
    const deckForUse = fullDeckData || deck
    if (!deckForUse) return []
    
    const forgebornList: CardInfo[] = []
    
    // First, try to find Forgeborn by forgebornId (most reliable)
    if (deckForUse.forgebornId) {
      const forgeborn = normalizedCards.find(card => 
        card.id === deckForUse.forgebornId || 
        (card.id && deckForUse.forgebornId && card.id.includes(deckForUse.forgebornId)) ||
        (deckForUse.forgebornId && card.id && deckForUse.forgebornId.includes(card.id))
      )
      if (forgeborn) {
        forgebornList.push(forgeborn)
      } else if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
        // If forgeborn not found in normalizedCards, try to get it from deckForUse.forgeborn object
        const forgebornId = deckForUse.forgeborn.id || deckForUse.forgebornId
        const forgebornFromObject = getCardInfo(forgebornId, deckForUse.forgeborn)
        if (forgebornFromObject && !forgebornList.some(fb => fb.id === forgebornFromObject.id)) {
          forgebornList.push(forgebornFromObject)
        }
      }
    } else if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object' && deckForUse.forgeborn.id) {
      // If no forgebornId but we have forgeborn object, use it
      const forgebornFromObject = getCardInfo(deckForUse.forgeborn.id, deckForUse.forgeborn)
      if (forgebornFromObject && !forgebornList.some(fb => fb.id === forgebornFromObject.id)) {
        forgebornList.push(forgebornFromObject)
      }
    }
    
    // For fused decks, ensure first forgeborn is found from first source deck
    // This is important because first forgeborn might not be in normalizedCards
    if (deckForUse.format === 'Fused') {
      const [deck1, deck2] = getFusedDeckSourceDecks
      const fusedDeckAny = deckForUse as any
      
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
      // Check if first forgeborn is already in the list by ID match
      const firstForgebornAlreadyInList = firstForgebornId && forgebornList.some(fb => 
        fb.id === firstForgebornId || 
        (fb.id && firstForgebornId && fb.id.includes(firstForgebornId)) ||
        (firstForgebornId && fb.id && firstForgebornId.includes(fb.id))
      )
      
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
          forgebornList.push(firstForgeborn)
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
          !forgebornList.some(fb => fb.id === card.id)
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
        
        if (secondForgeborn && !forgebornList.some(fb => fb.id === secondForgeborn!.id)) {
          forgebornList.push(secondForgeborn)
        }
      }
    }
    
    // Check forgeborn.solbindCards for second forgeborn (alternative forgeborn)
    if (deckForUse.forgeborn && typeof deckForUse.forgeborn === 'object') {
      if (process.env.NODE_ENV === 'development') {
        console.log('[DeckDetails] Forgeborn object:', deckForUse.forgeborn)
        console.log('[DeckDetails] Forgeborn solbindCards:', deckForUse.forgeborn.solbindCards)
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
              console.log(`[DeckDetails] Checking solbindCard ${solbindCard.id}:`, {
                name: solbindCard.name,
                cardType,
                rarity,
                isForgebornCard,
                isNotSolbind
              })
            }
            
            if (isForgebornCard && isNotSolbind) {
              // Check if this forgeborn is already in the list
              const alreadyInList = forgebornList.some(fb => 
                fb.id === solbindCard.id || 
                (fb.id && solbindCard.id && fb.id.includes(solbindCard.id)) ||
                (solbindCard.id && fb.id && solbindCard.id.includes(fb.id))
              )
              
              if (!alreadyInList) {
                const secondForgeborn = getCardInfo(solbindCard.id, solbindCard)
                forgebornList.push(secondForgeborn)
                if (process.env.NODE_ENV === 'development') {
                  console.log(`[DeckDetails] ✅ Added second forgeborn: ${secondForgeborn.name} (${secondForgeborn.id})`)
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

  // Reset selected card when deck changes
  useEffect(() => {
    if (deck?.id) {
      setSelectedCard(null)
      setSelectedLevel(1)
    }
  }, [deck?.id]) // Reset when deck changes

  // Select the first card by default when deck changes or modal opens
  // Prefer Forgeborn if available, otherwise select the first card
  useEffect(() => {
    if (opened && normalizedCards.length > 0 && !selectedCard) {
      // First, try to select Forgeborn if available
      if (forgebornCards.length > 0) {
        setSelectedCard(forgebornCards[0])
        setSelectedLevel(1)
      } else {
        // If no Forgeborn, select the first card
        setSelectedCard(normalizedCards[0])
        setSelectedLevel(1)
      }
    }
  }, [opened, normalizedCards.length, deck?.id, forgebornCards, selectedCard]) // Only depend on stable values

  // Reset level when card changes (but preserve if user selected a different level)
  // Use ref to track if level was manually changed by user
  const levelManuallyChangedRef = useRef<boolean>(false)
  const lastSelectedCardIdRef = useRef<string | null>(null)
  
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
  }, [selectedCard?.id]) // Only depend on card ID, not cardImages
  
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
        console.log(`[DeckDetails] Auto-selecting first available level ${firstAvailableLevel} for Solbind card ${selectedCard.id} (current level ${selectedLevel} doesn't exist)`)
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
    return normalizedCards.filter(card => {
      if (forgebornCards.includes(card)) return false
      
      // Check if this card is a solbind card (from solbindCards array)
      if (solbindCardIdsSet.has(card.id)) return false
      
      const cardData = card as any
      const name = card.name?.toLowerCase() || ''
      
      // Use ONLY cardType to determine if spell
      const cardType = cardData.cardType || cardData.card_type || ''
      const lowerCardType = cardType.toLowerCase()
      return lowerCardType.includes('spell') && !lowerCardType.includes('creature')
    })
  }, [normalizedCards, forgebornCards, solbindCardIdsSet, deck])

  const solbindCards: CardInfo[] = useMemo(() => {
    const deckForUse = fullDeckData || deck
    if (!deckForUse) return []
    
    // Extract Solbind cards from solbindCards arrays in other cards
    const solbindCardObjects: CardInfo[] = []
    
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
              console.log(`[DeckDetails] ✅ Added Solbind card from forgeborn.solbindCards: ${solbindCard.name || solbindCard.id} (${solbindCard.id})`)
            }
          }
        }
      })
    }
    
    // Second, find all cards that have solbindCards array and extract those cards
    normalizedCards.forEach(card => {
      const cardData = card as any
      if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
        cardData.solbindCards.forEach((solbindCard: any) => {
          if (solbindCard && solbindCard.id) {
            // Create CardInfo from solbind card data
            if (!solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
            solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
            }
          }
        })
      }
    })
    
    // Also check for cards in normalizedCards that are solbind cards
    normalizedCards.forEach(card => {
      if (forgebornCards.includes(card)) return
      
      const cardData = card as any
      const cardId = card.id
      
      // Skip if this card has solbindCards (it's the parent, not the solbind itself)
      if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
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
    
    if (process.env.NODE_ENV === 'development' && solbindCardObjects.length > 0) {
      console.log(`[DeckDetails] 📋 Total Solbind cards found: ${solbindCardObjects.length}`, solbindCardObjects.map(c => c.name || c.id))
    }
    
    return solbindCardObjects
  }, [normalizedCards, forgebornCards, solbindCardIdsSet, deck, fullDeckData])

  const creatureCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    return normalizedCards.filter(card =>
      !forgebornCards.includes(card) &&
      !spellCards.includes(card) &&
      !solbindCards.includes(card)
    )
  }, [normalizedCards, forgebornCards, spellCards, solbindCards, deck])

  const getFactionColor = useCallback((faction?: string) => {
    switch (faction) {
      case 'Alloyin': return 'cyan'
      case 'Uterra': return 'teal'
      case 'Tempys': return 'orange'
      case 'Nekrium': return 'grape'
      default: return 'gray'
    }
  }, [])

  const getFactionBadgeColor = useCallback((faction?: string) => {
    switch (faction) {
      case 'Alloyin': return '#06b6d4'
      case 'Uterra': return '#14b8a6'
      case 'Tempys': return '#f97316'
      case 'Nekrium': return '#a855f7'
      default: return '#6b7280'
    }
  }, [])

  // Get rarity icon path based on card set and rarity
  const getRarityIconPath = useCallback((cardSetNo?: string | number, rarity?: string, cardId?: string): string | null => {
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
    
    // Get set number: first try cardSetNo, then try to extract from cardId, default to 1
    let setNo = '1'
    if (cardSetNo) {
      setNo = String(cardSetNo)
    } else if (cardId) {
      // Extract set number from cardId (e.g., "s3nn1arrogant-butcher" -> "3")
      const match = cardId.match(/^s(\d+)/i)
      if (match && match[1]) {
        setNo = match[1]
      }
    }
    
    // For set 99, use set 1 icons (s1_*.png)
    if (setNo === '99') {
      setNo = '1'
    }
    
    // Return local path for all rarities (including CommonCommon and RareRare)
    return `/images/icons/rarity/S${setNo}_${normalizedRarity}.png`
  }, [])

  // Early return AFTER all hooks
  if (!deck) return null

  const CardListItem = ({ card, onClick }: { card: CardInfo; onClick: () => void }) => {
    const cardData = card as any
    const isBetrayer = cardData.betrayer === true || cardData.betrayer === 'true'
    // For betrayer cards, use crossFaction for icon, otherwise use regular faction
    const factionForIcon = isBetrayer && cardData.crossFaction 
      ? cardData.crossFaction 
      : (card.faction || deck.faction)
    const factionColor = getFactionBadgeColor(factionForIcon)
    const rarity = cardData.rarity || card.rarity
    const rarityIconPath = getRarityIconPath(deck.cardSetNo, rarity, card.id)
    const faction = (factionForIcon || '').toLowerCase()
    const factionIconPath = faction ? `/images/icons/${faction}.png` : null
    
    const handleClick = useCallback((e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onClick()
    }, [onClick])
    
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      // Also handle mousedown for better responsiveness
      if (e.button === 0) { // Left mouse button only
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }
    }, [onClick])
    
    return (
      <Button
        variant={selectedCard?.id === card.id ? 'filled' : 'subtle'}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        className="w-full h-auto"
        styles={{
          root: {
            backgroundColor: selectedCard?.id === card.id 
              ? 'rgba(74, 144, 226, 0.2)' 
              : 'transparent',
            border: selectedCard?.id === card.id 
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
            pointerEvents: 'none', // Prevent inner elements from blocking clicks
          },
        }}
      >
        <Group gap="xs" className="w-full" wrap="nowrap" justify="flex-start" style={{ margin: 0, pointerEvents: 'none' }}>
          {factionIconPath ? (
            <Image
              src={factionIconPath}
              alt={faction || 'Faction'}
              w={16}
              h={16}
              style={{
                flexShrink: 0,
                pointerEvents: 'none',
              }}
            />
          ) : (
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{
                backgroundColor: factionColor,
                opacity: 0.8,
                pointerEvents: 'none',
              }}
            />
          )}
          {rarityIconPath ? (
            <Image
              src={rarityIconPath}
              alt={rarity || 'Rarity'}
              w={16}
              h={16}
              style={{
                flexShrink: 0,
                pointerEvents: 'none',
              }}
            />
          ) : (
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{
                backgroundColor: factionColor,
                opacity: 0.8,
                pointerEvents: 'none',
              }}
            />
          )}
          <Text 
            size="sm" 
            className="text-white flex-1 text-left truncate"
            style={{ minWidth: 0, pointerEvents: 'none' }}
          >
            {card.name}
          </Text>
        </Group>
      </Button>
    )
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      transitionProps={{ duration: 300, timingFunction: 'ease-in-out' }}
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 3,
      }}
      closeOnClickOutside={true}
      closeOnEscape={true}
      title={
        <Group justify="space-between" className="w-full" wrap="nowrap">
          <Group gap="md" wrap="nowrap" className="flex-1 min-w-0">
            {parentFusedDeck && onDeckClick && (
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
            <Title order={3} className="text-white" style={{ flexShrink: 0 }}>
            {deck.name || 'Untitled Deck'}
          </Title>
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
              
              if (sourceDeck1 || sourceDeck2) {
                if (onDeckClick) {
                  return (
                    <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                      {sourceDeck1 && (
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
                      )}
                      {sourceDeck1 && sourceDeck2 && (
                        <Text size="xs" className="text-gray-500">
                          +
                        </Text>
                      )}
                      {sourceDeck2 && (
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
            )}
          </Group>
                  )
                } else {
                  // Show links without click handler (just text)
                  return (
                    <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                      {sourceDeck1 && (
                        <Text size="xs" className="text-blue-400">
                          {sourceDeck1.name || 'Deck 1'}
                        </Text>
                      )}
                      {sourceDeck1 && sourceDeck2 && (
                        <Text size="xs" className="text-gray-500">
                          +
                        </Text>
                      )}
                      {sourceDeck2 && (
                        <Text size="xs" className="text-blue-400">
                          {sourceDeck2.name || 'Deck 2'}
                        </Text>
                      )}
                    </Group>
                  )
                }
              }
              return null
            })()}
          </Group>
        </Group>
      }
      size="85vw"
      centered
      styles={{
        content: {
          backgroundColor: 'rgba(30, 41, 59, 0.98)',
          border: '1px solid rgba(74, 144, 226, 0.3)',
          maxWidth: '1200px',
          transition: 'transform 300ms ease-in-out, opacity 300ms ease-in-out',
        },
        header: {
          backgroundColor: 'rgba(30, 41, 59, 0.98)',
          borderBottom: '1px solid rgba(74, 144, 226, 0.2)',
        },
        body: {
          padding: '1.5rem',
        },
        overlay: {
          transition: 'opacity 300ms ease-in-out, backdrop-filter 300ms ease-in-out',
        },
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[70vh]">
        {/* Left column - card lists */}
        <div className="lg:col-span-1 flex flex-col">
          <ScrollArea className="flex-1" style={{ padding: 0 }}>
            <Stack gap="md" align="flex-start" style={{ padding: 0, margin: 0 }}>
              {/* Forgeborn */}
              {forgebornCards.length > 0 && (
                <div style={{ width: '100%' }}>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase" style={{ paddingLeft: 0 }}>
                    Forgeborn
                  </Text>
                  <Stack gap="xs" style={{ padding: 0, margin: 0 }}>
                    {forgebornCards.map((card) => (
                      <CardListItem
                        key={card.id}
                        card={card}
                        onClick={() => setSelectedCard(card)}
                      />
                    ))}
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
                    {creatureCards.map((card) => (
                      <CardListItem
                        key={card.id}
                        card={card}
                        onClick={() => setSelectedCard(card)}
                      />
                    ))}
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
                    {spellCards.map((card) => (
                      <CardListItem
                        key={card.id}
                        card={card}
                        onClick={() => setSelectedCard(card)}
                      />
                    ))}
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
                    {solbindCards.map((card) => (
                      <CardListItem
                        key={card.id}
                        card={card}
                        onClick={() => setSelectedCard(card)}
                      />
                    ))}
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
                    {normalizedCards.map((card) => (
                      <CardListItem
                        key={card.id}
                        card={card}
                        onClick={() => setSelectedCard(card)}
                      />
                    ))}
                  </Stack>
                </div>
              )}
            </Stack>
          </ScrollArea>
        </div>

        {/* Right column - detailed card information */}
        <div className="lg:col-span-2 flex flex-col">
          {selectedCard ? (
            <ScrollArea className="flex-1">
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
                  }}
                >
                  <div className="text-center w-full">
                    {(() => {
                      const cardImageData = cardImages[selectedCard.id]
                      const currentImageUrl = cardImageData?.[selectedLevel]
                      // Check error for specific card-level combination
                      const levelErrorKey = `${selectedCard.id}-${selectedLevel}`
                      const hasError = imageErrors.has(levelErrorKey)
                      
                      // Always log for debugging, especially for Solbind
                      console.log(`[DeckDetails] Rendering card image:`, {
                        cardId: selectedCard.id,
                        cardName: selectedCard.name,
                        level: selectedLevel,
                        hasImageData: !!cardImageData,
                        currentImageUrl,
                        hasError,
                        allLevels: cardImageData ? Object.keys(cardImageData) : [],
                        allImageUrls: cardImageData
                      })
                      
                      // Check if this is a Forgeborn card
                      const isForgeborn = deck?.forgebornId === selectedCard.id || 
                                         selectedCard.id === deck?.forgebornId ||
                                         (selectedCard.id && deck?.forgebornId && selectedCard.id.includes(deck.forgebornId)) ||
                                         (deck?.forgebornId && selectedCard.id && deck.forgebornId.includes(selectedCard.id)) ||
                                         selectedCard.type?.toLowerCase().includes('forgeborn') ||
                                         (selectedCard as any).cardType?.toLowerCase().includes('forgeborn')
                      
                      // Check if this is a Solbind card (use same logic as in image loading)
                      const selectedCardData = selectedCard as any
                      const isSolbind = solbindCardIdsSet.has(selectedCard.id) ||
                                       selectedCardData.rarity === 'Solbind' || selectedCardData.rarity === 'solbind' ||
                                       selectedCard.type?.toLowerCase() === 'solbind' ||
                                       selectedCardData.cardType?.toLowerCase() === 'solbind'
                      
                      // For Forgeborn, check if all three levels have the same URL (which means it's the 321 format)
                      // Card levels are 1, 2, 3 (not 0-indexed), so we check levels 1, 2, 3
                      const isForgebornImage = isForgeborn && cardImageData && 
                                               cardImageData[1] && cardImageData[2] && cardImageData[3] &&
                                               cardImageData[1] === cardImageData[2] && 
                                               cardImageData[2] === cardImageData[3]
                      
                      // For Solbind, use selectedLevel (can be 1, 2, or 3)
                      const effectiveLevel = selectedLevel
                      const effectiveImageUrl = currentImageUrl
                      
                      // For creatures and spells, show image even if it hasn't loaded yet
                      // (we'll show a placeholder while loading)
                      const isCreatureOrSpell = !isForgeborn && !isSolbind
                      
                      return (cardImageData && effectiveImageUrl && !hasError) || (isCreatureOrSpell && !hasError) ? (
                      <div className="relative w-full h-full flex flex-col items-center justify-center gap-4">
                        {effectiveImageUrl ? (
                          <img
                            src={effectiveImageUrl}
                            alt={isForgeborn ? selectedCard.name : isSolbind ? selectedCard.name : `${selectedCard.name} Level ${effectiveLevel}`}
                            className="max-w-full max-h-full object-contain"
                            style={{
                              maxWidth: isForgeborn ? '400px' : '300px',
                              maxHeight: isForgeborn ? '600px' : '450px',
                              transform: isForgeborn ? 'rotate(-90deg)' : 'none',
                            }}
                            onMouseMove={!isForgeborn ? handleMouseMove : undefined}
                            onMouseLeave={!isForgeborn ? handleMouseLeave : undefined}
                            onError={(e) => {
                              console.error(`[DeckDetails] Image error for ${selectedCard.id} level ${effectiveLevel}:`, e)
                              setImageErrors(prev => new Set(prev).add(`${selectedCard.id}-${effectiveLevel}`))
                            }}
                          />
                        ) : isCreatureOrSpell ? (
                          // Show placeholder for creatures/spells while image is loading
                          <div
                            className="w-64 h-96 mx-auto rounded-lg border-2 flex flex-col items-center justify-center gap-2"
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
                        ) : (
                          // Fallback placeholder
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
                        )}
                        {/* Level selector buttons - show for creatures and spells (always show all 3 levels) */}
                        {/* For Solbind cards, only show levels that have images */}
                        {!isForgeborn && (
                          <Group gap="xs" justify="center">
                            {[1, 2, 3]
                              .filter(level => {
                                // For Solbind cards, only show levels that have images (no placeholder for missing levels)
                                if (isSolbind) {
                                  const hasImage = cardImages[selectedCard.id]?.[level]
                                  return !!hasImage // Only show if image exists
                                }
                                // For creatures and spells, always show all 3 levels
                                // Even if image hasn't loaded yet (will show loading state)
                                return true
                              })
                              .map(level => {
                                // For creatures and spells, always show all 3 levels
                                // Even if image hasn't loaded yet
                                const hasImage = cardImages[selectedCard.id]?.[level]
                                const levelErrorKey = `${selectedCard.id}-${level}`
                                const isLoading = !hasImage && !imageErrors.has(levelErrorKey)
                                
                                return (
                                  <Button
                                    key={level}
                                    size="sm"
                                    variant={selectedLevel === level ? 'filled' : 'outline'}
                                    onClick={() => handleLevelChange(level)}
                                    // Always enabled - allow user to select any level even if image hasn't loaded yet
                                    className={
                                      selectedLevel === level
                                        ? 'bg-sf-primary hover:bg-sf-primary/90'
                                        : 'border-sf-primary/50 text-sf-primary hover:bg-sf-primary/20'
                                    }
                                  >
                                    Level {level}
                                    {!hasImage && !imageErrors.has(`${selectedCard.id}-${level}`) && ' (loading...)'}
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

                {/* Card information */}
                <Paper
                  p="md"
                  className="backdrop-blur-md border border-sf-primary/30 rounded-lg"
                  style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
                >
                  <Stack gap="md">
                    <Group gap="xs">
                      <Title order={4} className="text-white">
                        {selectedCard.name}
                      </Title>
                      {(selectedCard.faction || deck.faction) && (
                        <Badge
                          color={getFactionColor(selectedCard.faction || deck.faction)}
                          variant="light"
                          size="lg"
                          leftSection={<IconHandFinger size={14} />}
                        >
                          {selectedCard.faction || deck.faction}
                        </Badge>
                      )}
                    </Group>

                    {selectedCard.type && (
                      <Text size="sm" className="text-gray-400">
                        Type: <span className="text-white">{selectedCard.type}</span>
                      </Text>
                    )}

                    {/* Forgeborn Abilities */}
                    {deck.forgeborn && 
                     (selectedCard.id === deck.forgebornId || 
                      selectedCard.id?.includes(deck.forgebornId || '') ||
                      deck.forgebornId?.includes(selectedCard.id)) && 
                     deck.forgeborn.levels && (
                      <div>
                        <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase">
                          Abilities
                        </Text>
                        <Stack gap="xs">
                          {Object.entries(deck.forgeborn.levels)
                            .sort(([levelA], [levelB]) => Number(levelA) - Number(levelB))
                            .map(([level, ability]: [string, any]) => (
                              <Paper
                                key={level}
                                p="sm"
                                className="backdrop-blur-md border border-sf-primary/20 rounded"
                                style={{ backgroundColor: 'rgba(30, 41, 59, 0.4)' }}
                              >
                                <Group gap="xs" align="flex-start">
                                  <Badge
                                    color="blue"
                                    variant="filled"
                                    size="sm"
                                    style={{ minWidth: '40px', justifyContent: 'center' }}
                                  >
                                    {level}
                                  </Badge>
                                  <div className="flex-1">
                                    {ability.name && (
                                      <Text size="sm" className="text-white font-semibold mb-1">
                                        {ability.name}
                                      </Text>
                                    )}
                                    {ability.text && (
                                      <Text 
                                        size="xs" 
                                        className="text-gray-300"
                                        dangerouslySetInnerHTML={{ __html: processHtmlContent(String(ability.text)) }}
                                      />
                                    )}
                                    {ability.abilityNo && (
                                      <Text size="xs" className="text-gray-500 mt-1">
                                        Ability #{ability.abilityNo}
                                      </Text>
                                    )}
                                  </div>
                                </Group>
                              </Paper>
                            ))}
                        </Stack>
                      </div>
                    )}

                    {selectedCard.id && (
                      <Text size="xs" className="text-gray-500">
                        ID: {selectedCard.id}
                      </Text>
                    )}

                    {/* Additional card information */}
                    {Object.entries(selectedCard)
                      .filter(([key]) => !['id', 'name', 'type', 'faction', 'imageUrl', 'rarity', 'cardType'].includes(key))
                      .map(([key, value]) => {
                        if (value === null || value === undefined || value === '') return null
                        if (typeof value === 'object') return null // Skip objects
                        
                        const stringValue = String(value)
                        const hasHtml = /<[^>]+>/.test(stringValue)
                        
                        // Format key: don't add space for short uppercase abbreviations (SK, PK, etc.)
                        const formattedKey = key.length <= 2 && key === key.toUpperCase()
                          ? key
                          : key.replace(/([A-Z])/g, ' $1').trim()
                        
                        // Process HTML content if present
                        const processedValue = hasHtml ? processHtmlContent(stringValue) : stringValue
                        
                        return (
                          <div key={key}>
                            <Text size="sm" className="text-gray-400 capitalize">
                              {formattedKey}:{' '}
                              {hasHtml ? (
                                <span 
                                  className="text-white" 
                                  dangerouslySetInnerHTML={{ __html: processedValue }}
                                />
                              ) : (
                                <span className="text-white">{processedValue}</span>
                              )}
                            </Text>
                          </div>
                        )
                      })}
                  </Stack>
                </Paper>
              </Stack>
            </ScrollArea>
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
