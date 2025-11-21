'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Modal, Stack, Paper, Title, Text, Group, Badge, Button, ScrollArea, Divider, Image, Loader } from '@mantine/core'
import { IconHandFinger, IconCalendar } from '@tabler/icons-react'
import type { Deck } from '@/store/deckStore'
import { formatCardName, getCardImageUrl, getCardImageUrls, getCardInfo, type CardInfo } from '@/lib/api'

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
}

export function DeckDetails({ deck, opened, onClose }: DeckDetailsProps) {
  const [selectedCard, setSelectedCard] = useState<CardInfo | null>(null)
  const [selectedLevel, setSelectedLevel] = useState<number>(1) // Current card level (1, 2, or 3)
  const [cardImages, setCardImages] = useState<Record<string, Record<number, string>>>({}) // cardId -> level -> imageUrl
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())

  // Normalize cards with real names (memoized for stability)
  const normalizedCards: CardInfo[] = useMemo(() => {
    if (!deck || !deck.cards || !Array.isArray(deck.cards)) return []
    
    const cards = deck.cards.map((card: any, index: number) => {
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
  }, [deck?.id, deck?.cards])

  // First, extract all solbind card IDs to avoid circular dependency
  // Use a stable string representation for dependencies
  const solbindCardIdsSet = useMemo(() => {
    if (!deck) return new Set<string>()
    const ids = new Set<string>()
    
    // Add Solbind cards from solbindCards arrays
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
  }, [normalizedCards, deck])
  
  // Create a stable string representation for use in dependencies
  const solbindCardIdsKey = useMemo(() => {
    return Array.from(solbindCardIdsSet).sort().join(',')
  }, [solbindCardIdsSet])

  // Helper function to load a single image
  const loadSingleImage = async (cardId: string, level: number, isForgeborn: boolean): Promise<string | null> => {
    return new Promise((resolve) => {
      const imageUrl = getCardImageUrl(cardId, level, isForgeborn)
      const img = new window.Image()
      const timeout = setTimeout(() => {
        resolve(null)
      }, isForgeborn ? 10000 : 5000)
      
      img.onload = () => {
        clearTimeout(timeout)
        resolve(imageUrl)
      }
      img.onerror = () => {
        clearTimeout(timeout)
        resolve(null)
      }
      img.src = imageUrl
    })
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

      // Categorize cards (we need to compute these here since useMemo hooks are defined later)
      const forgebornCardsList: CardInfo[] = []
      const creatureCardsList: CardInfo[] = []
      const spellCardsList: CardInfo[] = []
      const solbindCardsList: CardInfo[] = []

      // First, identify Forgeborn
      if (deck?.forgebornId) {
        const forgeborn = normalizedCards.find(card => 
          card.id === deck.forgebornId || 
          (card.id && deck.forgebornId && card.id.includes(deck.forgebornId)) ||
          (deck.forgebornId && card.id && deck.forgebornId.includes(card.id))
        )
        if (forgeborn) {
          forgebornCardsList.push(forgeborn)
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

        // Check if spell
        const name = card.name?.toLowerCase() || ''
        const isSpell = cardData.cardType === 'Spell' || card.type?.toLowerCase().includes('spell') ||
                        card.id?.toLowerCase().includes('spell') || name.includes('spell') ||
                        name.includes('chanting of the abyss') || name.includes('dark pryings') ||
                        name.includes('sacrifice chamber')
        
        if (isSpell) {
          spellCardsList.push(card)
        } else {
          creatureCardsList.push(card)
        }
      })

      // Also add Solbind cards from solbindCards arrays
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
        
        console.log(`[DeckDetails] 📦 [${level + 1}/5] Loading all Creatures/Spells Level ${level}...`)
        
        // Load all cards of this level in parallel (but await each to maintain order)
        for (const card of regularCards) {
          if (!isModalOpen) {
            console.log(`[DeckDetails] ⏹️ Stopping card loading - modal closed`)
            break
          }
          
          // Skip if already loaded
          if (cardImages[card.id] && cardImages[card.id][level]) {
            continue
          }

          const imageUrl = await loadSingleImage(card.id, level, false)
          
          if (!isModalOpen) {
            console.log(`[DeckDetails] ⏹️ Stopping after card load - modal closed`)
            break
          }
          
          if (imageUrl) {
            // Update state immediately
            updateImageState(card.id, level, imageUrl)
            console.log(`[DeckDetails] ✅ Level ${level} loaded: ${card.id} (${card.name})`)
          }
        }
      }

      // 5. Load Solbind last
      if (!isModalOpen) {
        console.log(`[DeckDetails] ⏹️ Skipping Solbind loading - modal closed`)
        return
      }
      
      console.log(`[DeckDetails] 🔷 [5/5] Loading Solbind cards...`)
      for (const card of solbindCardsList) {
        if (!isModalOpen) {
          console.log(`[DeckDetails] ⏹️ Stopping Solbind loading - modal closed`)
          break
        }
        
        if (cardImages[card.id] && Object.keys(cardImages[card.id]).length > 0) {
          console.log(`[DeckDetails] Skipping Solbind ${card.id} - already loaded`)
          continue
        }

        console.log(`[DeckDetails] 🔷 Loading Solbind: ${card.id} (${card.name})`)
        
        for (let level = 1; level <= 3; level++) {
          if (!isModalOpen) {
            console.log(`[DeckDetails] ⏹️ Stopping Solbind level loading - modal closed`)
            break
          }
          
          const imageUrl = await loadSingleImage(card.id, level, false)
          
          if (!isModalOpen) {
            console.log(`[DeckDetails] ⏹️ Stopping after Solbind load - modal closed`)
            break
          }
          
          if (imageUrl) {
            // Update state immediately for each level
            updateImageState(card.id, level, imageUrl)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, normalizedCards.length, deck?.id, solbindCardIdsKey]) // Only depend on stable values

  // Group cards by categories - must be before any conditional returns
  const forgebornCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    
    // First, try to find Forgeborn by forgebornId (most reliable)
    if (deck.forgebornId) {
      const forgeborn = normalizedCards.find(card => 
        card.id === deck.forgebornId || 
        (card.id && deck.forgebornId && card.id.includes(deck.forgebornId)) ||
        (deck.forgebornId && card.id && deck.forgebornId.includes(card.id))
      )
      if (forgeborn) {
        return [forgeborn]
      }
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
  }, [normalizedCards, deck?.forgebornId, deck])

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

  // Reset level when card changes
  useEffect(() => {
    if (selectedCard) {
      // For Solbind cards, find the first available level
      const cardImageData = cardImages[selectedCard.id]
      if (cardImageData) {
        const availableLevels = Object.keys(cardImageData).map(Number).sort()
        if (availableLevels.length > 0) {
          setSelectedLevel(availableLevels[0])
        } else {
          setSelectedLevel(1)
        }
      } else {
        // For all cards, start with level 1 (user can change it with level selector)
        setSelectedLevel(1)
      }
    }
  }, [selectedCard?.id, cardImages])

  const spellCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    return normalizedCards.filter(card => {
      if (forgebornCards.includes(card)) return false
      
      // Check if this card is a solbind card (from solbindCards array)
      if (solbindCardIdsSet.has(card.id)) return false
      
      const cardData = card as any
      const name = card.name?.toLowerCase() || ''
      
      // Check cardType first
      if (cardData.cardType === 'Spell' || card.type?.toLowerCase().includes('spell')) {
        return true
      }
      
      // Fallback checks
      return card.id?.toLowerCase().includes('spell') ||
             name.includes('spell') ||
             name.includes('chanting of the abyss') ||
             name.includes('dark pryings') ||
             name.includes('sacrifice chamber') ||
             (name.includes('chanting') && name.includes('abyss')) ||
             (name.includes('dark') && name.includes('pryings')) ||
             (name.includes('sacrifice') && name.includes('chamber'))
    })
  }, [normalizedCards, forgebornCards, solbindCardIdsSet, deck])

  const solbindCards: CardInfo[] = useMemo(() => {
    if (!deck) return []
    
    // Extract Solbind cards from solbindCards arrays in other cards
    const solbindCardObjects: CardInfo[] = []
    
    // First, find all cards that have solbindCards array and extract those cards
    normalizedCards.forEach(card => {
      const cardData = card as any
      if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
        cardData.solbindCards.forEach((solbindCard: any) => {
          if (solbindCard && solbindCard.id) {
            // Create CardInfo from solbind card data
            solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
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
    
    return solbindCardObjects
  }, [normalizedCards, forgebornCards, solbindCardIdsSet, deck])

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

  // Early return AFTER all hooks
  if (!deck) return null

  const CardListItem = ({ card, onClick }: { card: CardInfo; onClick: () => void }) => {
    const factionColor = getFactionBadgeColor(card.faction || deck.faction)
    
    return (
      <Button
        variant={selectedCard?.id === card.id ? 'filled' : 'subtle'}
        onClick={onClick}
        className="w-full justify-start h-auto p-2"
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
          },
        }}
      >
        <Group gap="xs" className="w-full" wrap="nowrap">
          <IconHandFinger 
            size={16} 
            style={{ 
              color: factionColor,
              flexShrink: 0,
            }} 
          />
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{
              backgroundColor: factionColor,
              opacity: 0.8,
            }}
          />
          <Text 
            size="sm" 
            className="text-white flex-1 text-left truncate"
            style={{ minWidth: 0 }}
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
      title={
        <Group justify="space-between" className="w-full">
          <Title order={3} className="text-white">
            {deck.name || 'Untitled Deck'}
          </Title>
          <Group gap="xs">
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
              <Text size="xs" className="text-gray-400">
                {deck.format}
              </Text>
            )}
          </Group>
        </Group>
      }
      size="90vw"
      centered
      styles={{
        content: {
          backgroundColor: 'rgba(30, 41, 59, 0.98)',
          border: '1px solid rgba(74, 144, 226, 0.3)',
          maxWidth: '1400px',
        },
        header: {
          backgroundColor: 'rgba(30, 41, 59, 0.98)',
          borderBottom: '1px solid rgba(74, 144, 226, 0.2)',
        },
        body: {
          padding: '1.5rem',
        },
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[70vh]">
        {/* Left column - card lists */}
        <div className="lg:col-span-1 flex flex-col">
          <ScrollArea className="flex-1">
            <Stack gap="md">
              {/* Forgeborn */}
              {forgebornCards.length > 0 && (
                <div>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase">
                    Forgeborn
                  </Text>
                  <Stack gap="xs">
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
                <div>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase">
                    Creatures ({creatureCards.length})
                  </Text>
                  <Stack gap="xs">
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
                <div>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase">
                    Spells ({spellCards.length})
                  </Text>
                  <Stack gap="xs">
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
                <div>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase">
                    Solbind ({solbindCards.length})
                  </Text>
                  <Stack gap="xs">
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
                <div>
                  <Text size="sm" className="text-gray-400 mb-2 font-semibold uppercase">
                    Cards ({normalizedCards.length})
                  </Text>
                  <Stack gap="xs">
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
                      const hasError = imageErrors.has(selectedCard.id)
                      
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
                      const isForgebornImage = isForgeborn && cardImageData && 
                                               cardImageData[1] === cardImageData[2] && 
                                               cardImageData[2] === cardImageData[3]
                      
                      // For Solbind, use selectedLevel (can be 1, 2, or 3)
                      const effectiveLevel = selectedLevel
                      const effectiveImageUrl = currentImageUrl
                      
                      return cardImageData && effectiveImageUrl && !hasError ? (
                      <div className="relative w-full h-full flex flex-col items-center justify-center gap-4">
                        <img
                          src={effectiveImageUrl}
                          alt={isForgeborn ? selectedCard.name : isSolbind ? selectedCard.name : `${selectedCard.name} Level ${effectiveLevel}`}
                          className="max-w-full max-h-full object-contain"
                          style={{
                            maxWidth: isForgeborn ? '400px' : '300px',
                            maxHeight: isForgeborn ? '600px' : '450px',
                            transform: isForgeborn ? 'rotate(-90deg)' : 'none',
                          }}
                          onError={(e) => {
                            console.error(`[DeckDetails] Image error for ${selectedCard.id} level ${effectiveLevel}:`, e)
                            setImageErrors(prev => new Set(prev).add(selectedCard.id))
                          }}
                        />
                        {/* Level selector buttons - show for cards with multiple levels (including Solbind, but not Forgeborn) */}
                        {!isForgebornImage && cardImages[selectedCard.id] && Object.keys(cardImages[selectedCard.id]).length > 1 && (
                          <Group gap="xs" justify="center">
                            {[1, 2, 3].map(level => (
                              cardImages[selectedCard.id][level] ? (
                                <Button
                                  key={level}
                                  size="sm"
                                  variant={selectedLevel === level ? 'filled' : 'outline'}
                                  onClick={() => setSelectedLevel(level)}
                                  className={
                                    selectedLevel === level
                                      ? 'bg-sf-primary hover:bg-sf-primary/90'
                                      : 'border-sf-primary/50 text-sf-primary hover:bg-sf-primary/20'
                                  }
                                >
                                  Level {level}
                                </Button>
                              ) : null
                            ))}
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
