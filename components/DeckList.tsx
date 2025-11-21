'use client'

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { Stack, Paper, Title, Text, Group, Badge, Grid, TextInput, NumberInput, Select, MultiSelect, Collapse, Button } from '@mantine/core'
import { IconCards, IconCalendar, IconFilter, IconX } from '@tabler/icons-react'
import { useDebouncedValue } from '@mantine/hooks'
import type { Deck } from '@/store/deckStore'
import { DeckDetails } from './DeckDetails'
import { getCardInfo } from '@/lib/api'

// Helper function to count cards as sum of creatures + spells + solbind (excluding Forgeborn)
function countPlayableCards(deck: Deck): { total: number; creatures: number; spells: number; solbind: number } {
  if (!deck.cards || !Array.isArray(deck.cards)) return { total: 0, creatures: 0, spells: 0, solbind: 0 }
  
  // Normalize cards
  const normalizedCards = deck.cards.map((card: any, index: number) => {
    if (typeof card === 'string') {
      return getCardInfo(card)
    } else if (typeof card === 'object' && card !== null) {
      const cardId = card.id || card.cardId || card.name || `card-${index}`
      return getCardInfo(cardId, card)
    }
    return getCardInfo(`card-${index}`)
  })
  
  // Extract Solbind card IDs from solbindCards arrays (same logic as DeckDetails)
  const solbindCardIds = new Set<string>()
  normalizedCards.forEach(card => {
    const cardData = card as any
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      cardData.solbindCards.forEach((solbindCard: any) => {
        if (solbindCard && solbindCard.id) {
          solbindCardIds.add(solbindCard.id)
        }
      })
    }
  })
  
  // Identify Forgeborn
  const forgebornId = deck.forgebornId
  const forgebornCards: any[] = []
  if (forgebornId) {
    const forgeborn = normalizedCards.find(card => 
      card.id === forgebornId || 
      (card.id && forgebornId && card.id.includes(forgebornId)) ||
      (forgebornId && card.id && forgebornId.includes(card.id))
    )
    if (forgeborn) {
      forgebornCards.push(forgeborn)
    }
  }
  if (forgebornCards.length === 0) {
    const forgebornByType = normalizedCards.find(card =>
      card.type?.toLowerCase().includes('forgeborn') ||
      (card as any).cardType?.toLowerCase().includes('forgeborn')
    )
    if (forgebornByType) {
      forgebornCards.push(forgebornByType)
    }
  }
  
  // Collect Solbind cards (same logic as DeckDetails)
  const solbindCardObjects: any[] = []
  
  // First, extract Solbind cards from solbindCards arrays
  normalizedCards.forEach(card => {
    const cardData = card as any
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      cardData.solbindCards.forEach((solbindCard: any) => {
        if (solbindCard && solbindCard.id) {
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
    
    // Skip parent cards with solbindCards array - they are not Solbind cards themselves
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      return
    }
    
    // Check if this card is in any solbindCards array (already added above)
    if (solbindCardIds.has(cardId)) {
      if (!solbindCardObjects.some(sb => sb.id === cardId)) {
        solbindCardObjects.push(card)
      }
      return
    }
    
    // Check if rarity is Solbind - but only if it's NOT a parent card
    // Parent cards with solbindCards are containers, not Solbind cards themselves
    if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
      if (!solbindCardObjects.some(sb => sb.id === cardId)) {
        solbindCardObjects.push(card)
      }
    }
  })
  
  // Categorize remaining cards
  let creatures = 0
  let spells = 0
  
  normalizedCards.forEach(card => {
    // Skip Forgeborn
    if (forgebornCards.includes(card)) return
    
    // Skip Solbind cards (already counted) - but NOT parent cards with solbindCards
    // Parent cards with solbindCards are regular cards (Spell or Creature)
    const cardData = card as any
    const isSolbindCard = solbindCardObjects.some(sb => sb.id === card.id)
    
    // Only skip if it's a Solbind card AND not a parent card
    if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
      return
    }
    
    // Parent cards with solbindCards array should be counted as regular cards (Spell or Creature)
    // They are NOT Solbind cards themselves
    
    // Check if spell (same logic as DeckDetails)
    const name = card.name?.toLowerCase() || ''
    const isSpell = cardData.cardType === 'Spell' || card.type?.toLowerCase().includes('spell') ||
                    card.id?.toLowerCase().includes('spell') || name.includes('spell') ||
                    name.includes('chanting of the abyss') || name.includes('dark pryings') ||
                    name.includes('sacrifice chamber') ||
                    (name.includes('chanting') && name.includes('abyss')) ||
                    (name.includes('dark') && name.includes('pryings')) ||
                    (name.includes('sacrifice') && name.includes('chamber'))
    
    if (isSpell) {
      spells++
    } else {
      creatures++
    }
  })
  
  const solbind = solbindCardObjects.length
  
  return { total: creatures + spells + solbind, creatures, spells, solbind }
}

interface DeckListProps {
  decks: Deck[]
}

interface FilterState {
  faction: string[]
  forgebornName: string[]
  cardName: string[]
  cardText: string
  tags: string
  attackOperator: '>=' | '<=' | '='
  attackValue: number | null
  healthOperator: '>=' | '<=' | '='
  healthValue: number | null
  rarityType: string
  rarityCount: number | null
}

export function DeckList({ decks }: DeckListProps) {
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null)
  const [detailsOpened, setDetailsOpened] = useState(false)
  const [filtersOpened, setFiltersOpened] = useState(false)
  
  const [filters, setFilters] = useState<FilterState>({
    faction: [],
    forgebornName: [],
    cardName: [],
    cardText: '',
    tags: '',
    attackOperator: '>=',
    attackValue: null,
    healthOperator: '>=',
    healthValue: null,
    rarityType: '',
    rarityCount: null,
  })
  
  // Debounced filters for text inputs (0.5 second delay)
  // Use Mantine's useDebouncedValue with trailing: true (default behavior)
  const [debouncedFilters] = useDebouncedValue(filters, 500)
  
  // Ref to store scroll position and first visible deck ID
  const scrollPositionRef = useRef<number>(0)
  const firstVisibleDeckIdRef = useRef<string | null>(null)
  const shouldRestoreScrollRef = useRef<boolean>(false)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  
  // Collect all unique card names from all decks for the dropdown
  const allCardNames = useMemo(() => {
    const cardNamesSet = new Set<string>()
    
    decks.forEach(deck => {
      if (deck.cards && Array.isArray(deck.cards)) {
        deck.cards.forEach((card: any) => {
          const cardInfo = typeof card === 'string' 
            ? getCardInfo(card)
            : getCardInfo(card.id || card.cardId || card.name || '', card)
          
          if (cardInfo.name && cardInfo.name.trim()) {
            cardNamesSet.add(cardInfo.name)
          }
        })
      }
    })
    
    return Array.from(cardNamesSet).sort()
  }, [decks])
  
  // Collect all unique Forgeborn names from all decks for the dropdown
  const allForgebornNames = useMemo(() => {
    const forgebornNamesSet = new Set<string>()
    
    decks.forEach(deck => {
      // Try to get Forgeborn from deck.forgeborn
      if (deck.forgeborn && deck.forgeborn.name) {
        forgebornNamesSet.add(deck.forgeborn.name)
      }
      
      // Also check in cards
      if (deck.cards && Array.isArray(deck.cards)) {
        const normalizedCards = deck.cards.map((card: any, index: number) => {
          if (typeof card === 'string') {
            return getCardInfo(card)
          } else if (typeof card === 'object' && card !== null) {
            const cardId = card.id || card.cardId || card.name || `card-${index}`
            return getCardInfo(cardId, card)
          }
          return getCardInfo(`card-${index}`)
        })
        
        // Find Forgeborn by forgebornId
        if (deck.forgebornId) {
          const forgeborn = normalizedCards.find(card => 
            card.id === deck.forgebornId || 
            (card.id && deck.forgebornId && card.id.includes(deck.forgebornId)) ||
            (deck.forgebornId && card.id && deck.forgebornId.includes(card.id))
          )
          if (forgeborn && forgeborn.name) {
            forgebornNamesSet.add(forgeborn.name)
          }
        }
        
        // Find Forgeborn by cardType
        const forgebornByType = normalizedCards.find(card =>
          card.type?.toLowerCase().includes('forgeborn') ||
          (card as any).cardType?.toLowerCase().includes('forgeborn')
        )
        if (forgebornByType && forgebornByType.name) {
          forgebornNamesSet.add(forgebornByType.name)
        }
      }
    })
    
    return Array.from(forgebornNamesSet).sort()
  }, [decks])
  
  // Save scroll position when debouncedFilters change (after debounce delay)
  useEffect(() => {
    // Save scroll position and first visible deck ID before filters are applied
    scrollPositionRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
    
    // Find first visible deck card
    const deckCards = document.querySelectorAll('[data-deck-id]')
    for (const card of deckCards) {
      const rect = card.getBoundingClientRect()
      if (rect.top >= 0 && rect.top < window.innerHeight) {
        firstVisibleDeckIdRef.current = card.getAttribute('data-deck-id')
        break
      }
    }
    
    shouldRestoreScrollRef.current = true
    
    // Prevent scroll during state update
    const currentScroll = scrollPositionRef.current
    
    // Immediately restore scroll to prevent any intermediate scrolling
    requestAnimationFrame(() => {
      document.documentElement.scrollTop = currentScroll
      document.body.scrollTop = currentScroll
      window.scrollTo(0, currentScroll)
    })
  }, [debouncedFilters])
  
  // Disable scroll restoration on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }
  }, [])

  const handleDeckClick = (deck: Deck) => {
    setSelectedDeck(deck)
    setDetailsOpened(true)
  }
  
  const clearFilters = () => {
    const emptyFilters = {
      faction: [],
      forgebornName: [],
      cardName: [],
      cardText: '',
      tags: '',
      attackOperator: '>=' as const,
      attackValue: null,
      healthOperator: '>=' as const,
      healthValue: null,
      rarityType: '',
      rarityCount: null,
    }
    setFilters(emptyFilters)
    // Note: debouncedFilters will update automatically after 500ms delay
    // For immediate clear, we need to update filters directly
  }
  
  const hasActiveFilters = useMemo(() => {
    return !!(
      debouncedFilters.faction.length > 0 ||
      debouncedFilters.forgebornName.length > 0 ||
      debouncedFilters.cardName.length > 0 ||
      debouncedFilters.cardText ||
      debouncedFilters.tags ||
      debouncedFilters.attackValue !== null ||
      debouncedFilters.healthValue !== null ||
      (debouncedFilters.rarityType && debouncedFilters.rarityCount !== null)
    )
  }, [debouncedFilters])
  
  // Filter decks based on filter criteria (using debounced filters)
  const filteredDecks = useMemo(() => {
    if (!hasActiveFilters) return decks
    
    return decks.filter(deck => {
      // Filter by faction first (multi-select)
      if (debouncedFilters.faction.length > 0) {
        if (!deck.faction || !debouncedFilters.faction.some(f => 
          deck.faction && deck.faction.toLowerCase() === f.toLowerCase()
        )) {
          return false
        }
      }
      
      // Normalize cards for this deck
      const normalizedCards = deck.cards && Array.isArray(deck.cards) 
        ? deck.cards.map((card: any, index: number) => {
            if (typeof card === 'string') {
              return getCardInfo(card)
            } else if (typeof card === 'object' && card !== null) {
              const cardId = card.id || card.cardId || card.name || `card-${index}`
              return getCardInfo(cardId, card)
            }
            return getCardInfo(`card-${index}`)
          })
        : []
      
      // Find Forgeborn
      let forgeborn: any = null
      if (deck.forgebornId) {
        forgeborn = normalizedCards.find(card => 
          card.id === deck.forgebornId || 
          (card.id && deck.forgebornId && card.id.includes(deck.forgebornId)) ||
          (deck.forgebornId && card.id && deck.forgebornId.includes(card.id))
        )
      }
      if (!forgeborn) {
        forgeborn = normalizedCards.find(card =>
          card.type?.toLowerCase().includes('forgeborn') ||
          (card as any).cardType?.toLowerCase().includes('forgeborn')
        )
      }
      if (!forgeborn && deck.forgeborn) {
        forgeborn = deck.forgeborn
      }
      
      // Filter by Forgeborn name (multi-select) - must match one of selected Forgeborn
      if (debouncedFilters.forgebornName.length > 0) {
        const forgebornName = forgeborn?.name || ''
        if (!forgebornName || !debouncedFilters.forgebornName.includes(forgebornName)) {
          return false
        }
      }
      
      // Filter by card name (multi-select) - must contain ALL selected cards
      if (debouncedFilters.cardName.length > 0) {
        const deckCardNames = normalizedCards
          .map(card => card.name?.toLowerCase())
          .filter((name): name is string => !!name)
        
        const hasAllSelectedCards = debouncedFilters.cardName.every(selectedName => 
          deckCardNames.includes(selectedName.toLowerCase())
        )
        
        if (!hasAllSelectedCards) {
          return false
        }
      }
      
      // Filter by card text (search in abilities, text, description, etc.)
      if (debouncedFilters.cardText) {
        const searchText = debouncedFilters.cardText.toLowerCase()
        const hasMatchingText = normalizedCards.some(card => {
          const cardData = card as any
          
          // Collect all text fields from card - search in original card data too
          // Get original card from deck.cards if available
          const originalCard = deck.cards && Array.isArray(deck.cards) 
            ? deck.cards.find((c: any) => {
                const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
                return cId === card.id
              })
            : null
          
          const cardToSearch = originalCard && typeof originalCard === 'object' ? originalCard : cardData
          
          // Collect all text fields
          const textFields: string[] = []
          
          // Helper to recursively extract all string values
          const extractStrings = (obj: any, depth: number = 0): void => {
            if (depth > 4) return // Limit recursion depth
            if (!obj) return
            
            if (typeof obj === 'string' && obj.length > 0) {
              textFields.push(obj)
              return
            }
            
            if (Array.isArray(obj)) {
              obj.forEach((item: any) => {
                extractStrings(item, depth + 1)
              })
              return
            }
            
            if (typeof obj !== 'object') return
            
            for (const key in obj) {
              // Skip certain fields
              if (['id', 'name', 'imageUrl', 'image', 'cardId', 'card_id'].includes(key)) {
                continue
              }
              
              const value = obj[key]
              if (value === null || value === undefined) continue
              
              if (typeof value === 'string' && value.length > 0) {
                textFields.push(value)
              } else {
                extractStrings(value, depth + 1)
              }
            }
          }
          
          // Extract all strings from card data
          extractStrings(cardToSearch)
          
          // Also check normalized card data
          if (cardToSearch !== cardData) {
            extractStrings(cardData)
          }
          
          // Search in all collected text fields
          return textFields.some(field => {
            if (!field || typeof field !== 'string') return false
            // Remove HTML tags for better matching
            const cleanField = field.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            return cleanField.toLowerCase().includes(searchText)
          })
        })
        if (!hasMatchingText) {
          return false
        }
      }
      
      // Filter by tags
      if (debouncedFilters.tags) {
        const searchTags = debouncedFilters.tags.toLowerCase().split(',').map(t => t.trim()).filter(Boolean)
        const deckTags: string[] = []
        
        // Collect tags from deck.tags
        if (deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
          Object.values(deck.tags).forEach(value => {
            if (value && typeof value === 'string') {
              deckTags.push(value.toLowerCase())
            }
          })
        }
        
        // Collect tags from card provides
        normalizedCards.forEach((card: any) => {
          const provides = card.provides || card.Provides
          if (provides) {
            if (typeof provides === 'string') {
              provides.split(',').forEach((p: string) => {
                const trimmed = p.trim().toLowerCase()
                if (trimmed) deckTags.push(trimmed)
              })
            } else if (Array.isArray(provides)) {
              provides.forEach((p: string) => {
                if (p && typeof p === 'string') {
                  const trimmed = p.trim().toLowerCase()
                  if (trimmed) deckTags.push(trimmed)
                }
              })
            }
          }
        })
        
        const hasMatchingTag = searchTags.some(searchTag => 
          deckTags.some(deckTag => deckTag.includes(searchTag))
        )
        if (!hasMatchingTag) {
          return false
        }
      }
      
      // Filter by attack value
      if (debouncedFilters.attackValue !== null) {
        const hasMatchingAttack = normalizedCards.some(card => {
          const cardData = card as any
          const attack = cardData.attack || cardData.Attack || cardData.ATK
          if (attack === null || attack === undefined) return false
          const attackNum = Number(attack)
          if (isNaN(attackNum)) return false
          
          switch (debouncedFilters.attackOperator) {
            case '>=':
              return attackNum >= debouncedFilters.attackValue!
            case '<=':
              return attackNum <= debouncedFilters.attackValue!
            case '=':
              return attackNum === debouncedFilters.attackValue!
            default:
              return false
          }
        })
        if (!hasMatchingAttack) {
          return false
        }
      }
      
      // Filter by health value
      if (debouncedFilters.healthValue !== null) {
        const hasMatchingHealth = normalizedCards.some(card => {
          const cardData = card as any
          const health = cardData.health || cardData.Health || cardData.HP || cardData.hp
          if (health === null || health === undefined) return false
          const healthNum = Number(health)
          if (isNaN(healthNum)) return false
          
          switch (debouncedFilters.healthOperator) {
            case '>=':
              return healthNum >= debouncedFilters.healthValue!
            case '<=':
              return healthNum <= debouncedFilters.healthValue!
            case '=':
              return healthNum === debouncedFilters.healthValue!
            default:
              return false
          }
        })
        if (!hasMatchingHealth) {
          return false
        }
      }
      
      // Filter by rarity count
      if (debouncedFilters.rarityType && debouncedFilters.rarityCount !== null) {
        // Count cards by rarity (same logic as display)
        const rarityCounts = new Map<string, number>()
        
        // Identify Forgeborn and Solbind (same logic as countPlayableCards)
        const forgebornId = deck.forgebornId
        const forgebornCards: any[] = []
        if (forgebornId) {
          const fb = normalizedCards.find(card => 
            card.id === forgebornId || 
            (card.id && forgebornId && card.id.includes(forgebornId)) ||
            (forgebornId && card.id && forgebornId.includes(card.id))
          )
          if (fb) forgebornCards.push(fb)
        }
        if (forgebornCards.length === 0) {
          const fb = normalizedCards.find(card =>
            card.type?.toLowerCase().includes('forgeborn') ||
            (card as any).cardType?.toLowerCase().includes('forgeborn')
          )
          if (fb) forgebornCards.push(fb)
        }
        
        const solbindCardIds = new Set<string>()
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                solbindCardIds.add(solbindCard.id)
              }
            })
          }
        })
        
        const solbindCardObjects: any[] = []
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                if (!solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
                  solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
                }
              }
            })
          }
        })
        normalizedCards.forEach(card => {
          if (forgebornCards.includes(card)) return
          const cardData = card as any
          const cardId = card.id
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            return
          }
          if (solbindCardIds.has(cardId)) {
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
        
        // Count rarity for creatures and spells
        normalizedCards.forEach(card => {
          if (forgebornCards.includes(card)) return
          const cardData = card as any
          const isSolbindCard = solbindCardObjects.some(sb => sb.id === card.id)
          if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
            return
          }
          
          const rarity = cardData.rarity
          if (rarity && typeof rarity === 'string') {
            let normalizedRarity = rarity.trim()
            if (normalizedRarity.includes('Common') && normalizedRarity.includes('Rare')) {
              normalizedRarity = 'Common Rare'
            } else if (normalizedRarity.toLowerCase().includes('common')) {
              normalizedRarity = 'Common'
            } else if (normalizedRarity.toLowerCase().includes('rare')) {
              normalizedRarity = 'Rare'
                        } else if (normalizedRarity.toLowerCase().includes('ls') || normalizedRarity.toLowerCase().includes('legendary')) {
                          normalizedRarity = 'LS'
            }
            
            const currentCount = rarityCounts.get(normalizedRarity) || 0
            rarityCounts.set(normalizedRarity, currentCount + 1)
          }
        })
        
        const deckRarityCount = rarityCounts.get(debouncedFilters.rarityType) || 0
        if (deckRarityCount < debouncedFilters.rarityCount) {
          return false
        }
      }
      
      return true
    })
  }, [decks, debouncedFilters, hasActiveFilters])
  
  // Restore scroll position after filteredDecks changes
  useEffect(() => {
    if (shouldRestoreScrollRef.current) {
      const savedScroll = scrollPositionRef.current
      
      // Restore scroll position immediately to prevent intermediate scrolling
      const restoreScroll = () => {
        // Try to restore by first visible deck ID first
        if (firstVisibleDeckIdRef.current && filteredDecks.length > 0) {
          const targetElement = document.querySelector(`[data-deck-id="${firstVisibleDeckIdRef.current}"]`)
          if (targetElement) {
            const elementTop = targetElement.getBoundingClientRect().top
            const currentScroll = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
            const newScroll = Math.max(0, currentScroll + elementTop - 100) // 100px offset from top
            
            // Force scroll - use direct assignment
            if (document.documentElement) {
              document.documentElement.scrollTop = newScroll
            }
            if (document.body) {
              document.body.scrollTop = newScroll
            }
            if (window.scrollTo) {
              window.scrollTo(0, newScroll)
            }
            
            shouldRestoreScrollRef.current = false
            firstVisibleDeckIdRef.current = null
            return
          }
        }
        
        // Fallback to saved scroll position
        if (document.documentElement) {
          document.documentElement.scrollTop = savedScroll
        }
        if (document.body) {
          document.body.scrollTop = savedScroll
        }
        if (window.scrollTo) {
          window.scrollTo(0, savedScroll)
        }
        
        shouldRestoreScrollRef.current = false
        firstVisibleDeckIdRef.current = null
      }
      
      // Restore immediately and repeatedly to prevent intermediate scrolling
      restoreScroll()
      
      // Also restore after React render cycles
      requestAnimationFrame(() => {
        restoreScroll()
        requestAnimationFrame(() => {
          restoreScroll()
          // Continue restoring to catch any late scroll events
          setTimeout(() => {
            restoreScroll()
            setTimeout(restoreScroll, 50)
            setTimeout(restoreScroll, 100)
          }, 10)
        })
      })
    }
  }, [filteredDecks.length]) // Only depend on length to avoid unnecessary runs

  if (decks.length === 0) {
    return (
      <Paper
        p="xl"
        className="w-full max-w-4xl backdrop-blur-md border border-sf-primary/30 rounded-xl"
        style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
      >
        <Text size="lg" className="text-center text-gray-400">
          No decks found
        </Text>
      </Paper>
    )
  }

  return (
    <>
      <div className="w-full max-w-6xl space-y-4">
        <Group justify="space-between" align="center" className="mb-4">
          <Title order={2} className="text-white">
            Found Decks ({filteredDecks.length}{hasActiveFilters ? ` / ${decks.length}` : ''})
          </Title>
          <Group gap="xs">
            <Button
              variant={filtersOpened ? 'filled' : 'outline'}
              leftSection={<IconFilter size={16} />}
              onClick={() => setFiltersOpened(!filtersOpened)}
              size="sm"
            >
              Filters
            </Button>
            {hasActiveFilters && (
              <Button
                variant="subtle"
                leftSection={<IconX size={16} />}
                onClick={clearFilters}
                size="sm"
                color="red"
              >
                Clear
              </Button>
            )}
          </Group>
        </Group>
        
        <Collapse in={filtersOpened}>
          <Paper
            p="md"
            className="mb-4 backdrop-blur-md border border-sf-primary/30 rounded-xl"
            style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
          >
            <Stack gap="md">
              <Title order={4} className="text-white">
                Filter Decks
              </Title>
              
              <Grid gutter="md">
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Faction"
                    placeholder="Select factions..."
                    value={filters.faction}
                    onChange={(value) => setFilters({ ...filters, faction: value })}
                    data={[
                      { value: 'Alloyin', label: 'Alloyin' },
                      { value: 'Uterra', label: 'Uterra' },
                      { value: 'Tempys', label: 'Tempys' },
                      { value: 'Nekrium', label: 'Nekrium' },
                    ]}
                    clearable
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Forgeborn Name"
                    placeholder="Select Forgeborn..."
                    data={allForgebornNames}
                    value={filters.forgebornName}
                    onChange={(value) => setFilters({ ...filters, forgebornName: value })}
                    clearable
                    searchable
                    className="text-white"
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                      dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                      option: { color: 'white' }
                    }}
                    onFocus={() => {
                      // Save scroll position when opening dropdown
                      scrollPositionRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
                    }}
                    onBlur={() => {
                      // Restore scroll position when closing dropdown
                      requestAnimationFrame(() => {
                        const savedScroll = scrollPositionRef.current
                        document.documentElement.scrollTop = savedScroll
                        document.body.scrollTop = savedScroll
                        window.scrollTo(0, savedScroll)
                      })
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Card Name"
                    placeholder="Select cards..."
                    value={filters.cardName}
                    onChange={(value) => {
                      // Save scroll position before changing filter
                      scrollPositionRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
                      shouldRestoreScrollRef.current = true
                      setFilters({ ...filters, cardName: value })
                    }}
                    onFocus={(e) => {
                      // Prevent automatic scroll to input on focus
                      e.preventDefault()
                      const savedScroll = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
                      scrollPositionRef.current = savedScroll
                      
                      // Restore scroll position after focus
                      requestAnimationFrame(() => {
                        window.scrollTo(0, savedScroll)
                      })
                    }}
                    data={allCardNames.map(name => ({ value: name, label: name }))}
                    searchable
                    clearable
                    maxDropdownHeight={300}
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <TextInput
                    label="Card Text"
                    placeholder="Search in card text/abilities..."
                    value={filters.cardText}
                    onChange={(e) => setFilters({ ...filters, cardText: e.target.value })}
                    className="text-white"
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <TextInput
                    label="Tags"
                    placeholder="Comma-separated tags..."
                    value={filters.tags}
                    onChange={(e) => setFilters({ ...filters, tags: e.target.value })}
                    className="text-white"
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Attack"
                      value={filters.attackOperator}
                      onChange={(value) => setFilters({ ...filters, attackOperator: value as any })}
                      data={[
                        { value: '>=', label: '≥' },
                        { value: '<=', label: '≤' },
                        { value: '=', label: '=' },
                      ]}
                      style={{ flex: '0 0 80px' }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="Value"
                      value={filters.attackValue || undefined}
                      onChange={(value) => setFilters({ ...filters, attackValue: typeof value === 'number' ? value : null })}
                      min={0}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Health"
                      value={filters.healthOperator}
                      onChange={(value) => setFilters({ ...filters, healthOperator: value as any })}
                      data={[
                        { value: '>=', label: '≥' },
                        { value: '<=', label: '≤' },
                        { value: '=', label: '=' },
                      ]}
                      style={{ flex: '0 0 80px' }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="Value"
                      value={filters.healthValue || undefined}
                      onChange={(value) => setFilters({ ...filters, healthValue: typeof value === 'number' ? value : null })}
                      min={0}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Rarity"
                      placeholder="Select rarity..."
                      value={filters.rarityType}
                      onChange={(value) => setFilters({ ...filters, rarityType: value || '' })}
                      data={[
                        { value: 'Common', label: 'Common' },
                        { value: 'Common Rare', label: 'Common Rare' },
                        { value: 'Rare', label: 'Rare' },
                        { value: 'LS', label: 'LS' },
                        { value: 'Solbind', label: 'Solbind' },
                      ]}
                      clearable
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="Min count"
                      value={filters.rarityCount || undefined}
                      onChange={(value) => setFilters({ ...filters, rarityCount: typeof value === 'number' ? value : null })}
                      min={0}
                      style={{ flex: '0 0 120px' }}
                      disabled={!filters.rarityType}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
              </Grid>
            </Stack>
          </Paper>
        </Collapse>
        
        {filteredDecks.length === 0 ? (
          <Paper
            p="xl"
            className="w-full backdrop-blur-md border border-sf-primary/30 rounded-xl"
            style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
          >
            <Text size="lg" className="text-center text-gray-400">
              No decks match the filters
            </Text>
          </Paper>
        ) : (
          <div 
            ref={gridContainerRef}
            style={{ 
              minHeight: '100vh', // Maintain minimum height to prevent scroll jump
            }}
          >
            <Grid 
              key="decks-grid"
              gutter="md" 
              style={{ 
                transition: 'all 0.3s ease',
                scrollBehavior: 'auto', // Prevent smooth scroll that might cause jumps
                willChange: 'contents' // Optimize rendering
              }}
            >
            {filteredDecks.map((deck) => (
            <Grid.Col key={deck.id} span={{ base: 12, sm: 6, md: 4 }}>
              <Paper
                data-deck-id={deck.id}
                p="lg"
                onClick={() => handleDeckClick(deck)}
                className="h-full backdrop-blur-md border border-sf-primary/20 rounded-xl hover:border-sf-primary/50 transition-all cursor-pointer hover:shadow-xl hover:shadow-sf-primary/20 hover:scale-[1.02]"
                style={{
                  backgroundColor: 'rgba(30, 41, 59, 0.5)',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(74, 144, 226, 0.1)',
                  minHeight: '200px',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
              >
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <Title order={4} className="text-white flex-1" lineClamp={2}>
                    {deck.name || 'Untitled'}
                  </Title>
                </Group>

                <Group gap="xs">
                  {deck.faction && (
                    <Badge
                      color={
                        deck.faction === 'Alloyin' ? 'cyan' :
                        deck.faction === 'Uterra' ? 'teal' :
                        deck.faction === 'Tempys' ? 'orange' :
                        deck.faction === 'Nekrium' ? 'grape' : 'gray'
                      }
                      variant="light"
                      size="sm"
                      style={{
                        fontWeight: 500,
                      }}
                    >
                      {deck.faction}
                    </Badge>
                  )}
                  {deck.cardSetNo && (
                    <Badge
                      color="indigo"
                      variant="light"
                      size="sm"
                    >
                      Set {deck.cardSetNo}
                    </Badge>
                  )}
                  {deck.cards && Array.isArray(deck.cards) && (
                    <Badge
                      color="blue"
                      variant="light"
                      size="sm"
                      leftSection={<IconCards size={12} />}
                    >
                      {countPlayableCards(deck).total} cards
                    </Badge>
                  )}
                  {deck.deckRank && deck.deckRank !== 'Unranked' && (
                    <Badge
                      color={
                        deck.deckRank === 'Platinum' ? 'gray' :
                        deck.deckRank === 'Gold' ? 'yellow' :
                        deck.deckRank === 'Silver' ? 'gray' :
                        deck.deckRank === 'Bronze' ? 'orange' : 'gray'
                      }
                      variant="light"
                      size="sm"
                    >
                      {deck.deckRank}
                    </Badge>
                  )}
                </Group>

                {deck.cards && Array.isArray(deck.cards) && (() => {
                  const counts = countPlayableCards(deck)
                  
                  // Collect rarity information from creatures and spells
                  // Use the same logic as countPlayableCards to ensure consistency
                  const rarityCounts = new Map<string, number>()
                  
                  // Normalize cards (same as in countPlayableCards)
                  const normalizedCards = deck.cards.map((card: any, index: number) => {
                    if (typeof card === 'string') {
                      return getCardInfo(card)
                    } else if (typeof card === 'object' && card !== null) {
                      const cardId = card.id || card.cardId || card.name || `card-${index}`
                      return getCardInfo(cardId, card)
                    }
                    return getCardInfo(`card-${index}`)
                  })
                  
                  // Extract Solbind card IDs (same logic as countPlayableCards)
                  const solbindCardIds = new Set<string>()
                  normalizedCards.forEach(card => {
                    const cardData = card as any
                    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
                      cardData.solbindCards.forEach((solbindCard: any) => {
                        if (solbindCard && solbindCard.id) {
                          solbindCardIds.add(solbindCard.id)
                        }
                      })
                    }
                  })
                  
                  // Identify Forgeborn (same logic as countPlayableCards)
                  const forgebornId = deck.forgebornId
                  const forgebornCards: any[] = []
                  if (forgebornId) {
                    const forgeborn = normalizedCards.find(card => 
                      card.id === forgebornId || 
                      (card.id && forgebornId && card.id.includes(forgebornId)) ||
                      (forgebornId && card.id && forgebornId.includes(card.id))
                    )
                    if (forgeborn) {
                      forgebornCards.push(forgeborn)
                    }
                  }
                  if (forgebornCards.length === 0) {
                    const forgebornByType = normalizedCards.find(card =>
                      card.type?.toLowerCase().includes('forgeborn') ||
                      (card as any).cardType?.toLowerCase().includes('forgeborn')
                    )
                    if (forgebornByType) {
                      forgebornCards.push(forgebornByType)
                    }
                  }
                  
                  // Collect Solbind cards (same logic as countPlayableCards)
                  const solbindCardObjects: any[] = []
                  normalizedCards.forEach(card => {
                    const cardData = card as any
                    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
                      cardData.solbindCards.forEach((solbindCard: any) => {
                        if (solbindCard && solbindCard.id) {
                          if (!solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
                            solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
                          }
                        }
                      })
                    }
                  })
                  normalizedCards.forEach(card => {
                    if (forgebornCards.includes(card)) return
                    const cardData = card as any
                    const cardId = card.id
                    
                    // Skip parent cards with solbindCards array - they are not Solbind cards themselves
                    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
                      return
                    }
                    
                    if (solbindCardIds.has(cardId)) {
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
                  
                  // Count rarity for creatures and spells (same logic as countPlayableCards)
                  normalizedCards.forEach(card => {
                    // Skip Forgeborn
                    if (forgebornCards.includes(card)) return
                    
                    const cardData = card as any
                    
                    // Skip Solbind cards (already counted) - but NOT parent cards with solbindCards
                    // Parent cards with solbindCards are regular cards (Spell or Creature)
                    const isSolbindCard = solbindCardObjects.some(sb => sb.id === card.id)
                    if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
                      return
                    }
                    
                    // Parent cards with solbindCards array should be counted for rarity
                    // They are NOT Solbind cards themselves
                    
                    // Check if spell (same logic as countPlayableCards)
                    const name = card.name?.toLowerCase() || ''
                    const isSpell = cardData.cardType === 'Spell' || card.type?.toLowerCase().includes('spell') ||
                                    card.id?.toLowerCase().includes('spell') || name.includes('spell') ||
                                    name.includes('chanting of the abyss') || name.includes('dark pryings') ||
                                    name.includes('sacrifice chamber') ||
                                    (name.includes('chanting') && name.includes('abyss')) ||
                                    (name.includes('dark') && name.includes('pryings')) ||
                                    (name.includes('sacrifice') && name.includes('chamber'))
                    
                    if (isSpell || !isSpell) { // Either spell or creature
                      const rarity = cardData.rarity
                      if (rarity && typeof rarity === 'string') {
                        // Normalize rarity names
                        let normalizedRarity = rarity.trim()
                        
                        // Handle combined rarities like "Common Rare" or "Rare Common"
                        if (normalizedRarity.includes('Common') && normalizedRarity.includes('Rare')) {
                          normalizedRarity = 'Common Rare'
                        } else if (normalizedRarity.toLowerCase().includes('common')) {
                          normalizedRarity = 'Common'
                        } else if (normalizedRarity.toLowerCase().includes('rare')) {
                          normalizedRarity = 'Rare'
                        } else if (normalizedRarity.toLowerCase().includes('ls') || normalizedRarity.toLowerCase().includes('legendary')) {
                          normalizedRarity = 'LS'
                        }
                        
                        const currentCount = rarityCounts.get(normalizedRarity) || 0
                        rarityCounts.set(normalizedRarity, currentCount + 1)
                      }
                    }
                  })
                  
                  return (
                    <Stack gap="xs">
                      <Group gap="xs">
                        <Badge color="green" variant="light" size="sm">
                          {counts.creatures} Creatures
                        </Badge>
                        <Badge color="pink" variant="light" size="sm">
                          {counts.spells} Spells
                        </Badge>
                        <Badge color="orange" variant="light" size="sm">
                          {counts.solbind} Solbind
                        </Badge>
                      </Group>
                      {Array.from(rarityCounts.entries()).length > 0 && (
                        <Group gap="xs">
                          {Array.from(rarityCounts.entries())
                            .sort(([a], [b]) => {
                              // Sort by rarity order: Common, Common Rare, Rare, LS
                              const order: Record<string, number> = {
                                'Common': 1,
                                'Common Rare': 2,
                                'Rare': 3,
                                'LS': 4
                              }
                              return (order[a] || 99) - (order[b] || 99)
                            })
                            .map(([rarity, count]) => {
                              // Get color for rarity
                              const getRarityColor = (rarityName: string): string => {
                                const normalized = rarityName.toLowerCase()
                                if (normalized.includes('common') && normalized.includes('rare')) {
                                  return '#0e87cf' // RareCommon
                                } else if (normalized.includes('rare') && !normalized.includes('common')) {
                                  return '#e6b70c' // Rare
                                } else if (normalized.includes('common')) {
                                  return '#1199e3' // Common
                                } else if (normalized.includes('solbind')) {
                                  return '#75cec4' // Solbind
                                } else if (normalized.includes('ls')) {
                                  return '#a90100' // LS
                                }
                                return '#1199e3' // Default to Common
                              }
                              
                              return (
                                <Badge 
                                  key={rarity} 
                                  variant="light" 
                                  size="sm"
                                  style={{
                                    backgroundColor: getRarityColor(rarity),
                                    color: 'white',
                                    border: 'none'
                                  }}
                                >
                                  {count} {rarity}
                                </Badge>
                              )
                            })}
                        </Group>
                      )}
                    </Stack>
                  )
                })()}

                {deck.created && (
                  <Group gap="xs" className="text-gray-400 text-sm">
                    <IconCalendar size={14} />
                    <Text size="xs">
                      {new Date(deck.created).toLocaleDateString('en-US')}
                    </Text>
                  </Group>
                )}

                {(() => {
                  // Check if deck has tags
                  const hasTags = deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags) && Object.keys(deck.tags).length > 0
                  
                  // Collect tags from deck tags or provides
                  let tagsToDisplay: string[] = []
                  
                  if (hasTags) {
                    // Use existing tags
                    tagsToDisplay = Object.entries(deck.tags)
                      .map(([key, value]) => {
                        // Skip empty tags and tags with empty values
                        if (value === null || value === undefined || value === '') {
                          return null
                        }
                        
                        // Skip tags where key is 'none' and value is empty
                        if (key === 'none' && (!value || value === '')) {
                          return null
                        }
                        
                        // Skip if value is a string and empty after trim
                        if (typeof value === 'string' && value.trim() === '') {
                          return null
                        }
                        
                        // Use value if it's a non-empty string, otherwise use key (if key is meaningful)
                        let tagText: string | null = null
                        
                        if (typeof value === 'string' && value.trim() !== '') {
                          tagText = value.trim()
                        } else if (typeof value === 'number' || typeof value === 'boolean') {
                          tagText = String(value)
                        } else if (key && key !== 'none' && !key.startsWith('tag_')) {
                          // Use key if it's meaningful (not a generated key)
                          tagText = key
                        } else if (key && key.startsWith('tag_')) {
                          // For generated keys, try to use value or skip
                          return null
                        }
                        
                        return tagText && tagText.trim() !== '' ? tagText.trim() : null
                      })
                      .filter((tag): tag is string => tag !== null)
                  } else if (deck.cards && Array.isArray(deck.cards)) {
                    // Collect unique provides from cards
                    const providesSet = new Set<string>()
                    
                    deck.cards.forEach((card: any) => {
                      if (card && typeof card === 'object') {
                        const provides = card.provides || card.Provides
                        if (provides) {
                          if (typeof provides === 'string') {
                            // Split by comma and add each value
                            provides.split(',').forEach((p: string) => {
                              const trimmed = p.trim()
                              if (trimmed) {
                                providesSet.add(trimmed)
                              }
                            })
                          } else if (Array.isArray(provides)) {
                            provides.forEach((p: string) => {
                              if (p && typeof p === 'string') {
                                const trimmed = p.trim()
                                if (trimmed) {
                                  providesSet.add(trimmed)
                                }
                              }
                            })
                          }
                        }
                      }
                    })
                    
                    tagsToDisplay = Array.from(providesSet).sort()
                  }
                  
                  
                  if (tagsToDisplay.length === 0) {
                    return null
                  }
                  
                  return (
                    <Group gap="xs" className="mt-2 flex-wrap">
                      {tagsToDisplay.map((tagText) => (
                        <Badge
                          key={`${deck.id}-${tagText}`}
                          color="violet"
                          variant="light"
                          size="sm"
                        >
                          {tagText.toUpperCase()}
                        </Badge>
                      ))}
                    </Group>
                  )
                })()}
              </Stack>
            </Paper>
          </Grid.Col>
        ))}
      </Grid>
          </div>
        )}
      </div>
      
      <DeckDetails
        deck={selectedDeck}
        opened={detailsOpened}
        onClose={() => {
          setDetailsOpened(false)
          setSelectedDeck(null)
        }}
      />
    </>
  )
}

