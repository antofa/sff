/**
 * Utilities for working with SolForge Fusion API
 * 
 * Implemented based on Apps Script code from Google Sheets
 * API endpoint: https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/deck/app
 */

// Base URL for SolForge Fusion API (from Apps Script)
const API_BASE_URL = 'https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main'

export interface ApiDeck {
  id: string
  name: string
  format?: string
  cards?: Array<{
    id: string
    name: string
    [key: string]: any
  }>
  created?: string
  [key: string]: any
}

/**
 * Normalize deck data from API
 * Data format matches response from /main/deck/app
 */
function normalizeDeck(deck: any): ApiDeck {
  if (!deck || typeof deck !== 'object') {
    throw new Error('Invalid deck data format')
  }

  // ID is mandatory
  const id = deck.id || deck.deckId || deck.deck_id
  if (!id) {
    throw new Error('Deck does not contain an ID')
  }

  // Normalize tags
  let normalizedTags: any = null
  if (deck.tags) {
    if (typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
      // Tags as object { key: value }
      normalizedTags = deck.tags
    } else if (Array.isArray(deck.tags)) {
      // Tags as array - convert to object
      normalizedTags = {}
      deck.tags.forEach((tag: any, index: number) => {
        if (typeof tag === 'string' && tag.trim() !== '') {
          normalizedTags[`tag_${index}`] = tag
        } else if (typeof tag === 'object' && tag !== null) {
          // If array element is an object, use its keys
          Object.assign(normalizedTags, tag)
        }
      })
    } else if (typeof deck.tags === 'string') {
      // Tags as string (possibly JSON or comma-separated)
      try {
        const parsed = JSON.parse(deck.tags)
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          normalizedTags = parsed
        }
      } catch {
        // If not JSON, split by commas
        const tagArray = deck.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '')
        if (tagArray.length > 0) {
          normalizedTags = {}
          tagArray.forEach((tag: string, index: number) => {
            normalizedTags[`tag_${index}`] = tag
          })
        }
      }
    }
    
    // Check that normalized tags are not empty
    if (normalizedTags && Object.keys(normalizedTags).length === 0) {
      normalizedTags = null
    }
  }

  // Extract cards - prefer cardList (full card objects) over cardIds (just IDs)
  let cards: any[] = []
  if (Array.isArray(deck.cardList) && deck.cardList.length > 0) {
    // cardList contains full card objects with cardType, rarity, etc.
    cards = deck.cardList
  } else if (Array.isArray(deck.cards)) {
    // If cards is an array of objects, preserve them
    cards = deck.cards
  } else if (Array.isArray(deck.cardIds)) {
    // cardIds is just an array of strings, less information
    cards = deck.cardIds
  }
  
  // If forgeborn exists but is not in cards, add it
  if (deck.forgeborn && deck.forgeborn.id) {
    const forgebornInCards = cards.some((card: any) => {
      const cardId = typeof card === 'string' ? card : card.id
      return cardId === deck.forgeborn.id || cardId === deck.forgebornId
    })
    if (!forgebornInCards) {
      // Add forgeborn as first card
      cards = [deck.forgeborn, ...cards]
    }
  }

  return {
    id: String(id),
    name: deck.name || deck.deckName || 'Untitled',
    format: deck.format || deck.gameFormat,
    cards: cards,
    created: deck.created || deck.createdAt || deck.CreatedAt || deck.pExpiry,
    // Additional fields from API
    faction: deck.faction,
    forgebornId: deck.forgebornId || (deck.forgeborn && deck.forgeborn.id),
    forgeborn: deck.forgeborn, // Preserve full forgeborn object with abilities
    deckRank: deck.deckRank || deck.rank,
    digital: deck.digital,
    tags: normalizedTags,
    cardSetNo: deck.cardSetNo,
    cardSetId: deck.cardSetId,
  }
}

/**
 * Get player decks via real API (as in Apps Script)
 * 
 * @param playerName - player nickname
 * @returns array of player decks
 */
/**
 * Fetch detailed deck information with full card data
 */
async function fetchDeckDetails(deckId: string): Promise<any> {
  try {
    const url = `${API_BASE_URL}/deck/${deckId}?inclCards=true&inclUsers=true`
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
      console.warn(`[API] Failed to fetch deck details for ${deckId}: ${response.status}`)
      return null
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.warn(`[API] Error fetching deck details for ${deckId}:`, error)
    return null
  }
}

async function fetchDecksFromAPI(playerName: string): Promise<ApiDeck[]> {
  const encodedName = encodeURIComponent(playerName.toLowerCase())
  const url = `${API_BASE_URL}/deck/app?inclPve=true&username=${encodedName}&inclCards=true`
  
  console.log(`[API] Requesting decks for player: ${playerName}`)
  console.log(`[API] URL: ${url}`)

  let allDecks: any[] = []
  let lastPK = ""
  let pageCount = 0
  const maxPages = 100 // Protection against infinite loop

  try {
    // First request
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SolForge-Fusion-Deck-Viewer/1.0',
        },
        // In Next.js we can use cache: 'no-store' for server requests
        cache: 'no-store',
        // Increase timeout
        signal: AbortSignal.timeout(20000), // 20 seconds
      })
    } catch (fetchError) {
      console.error(`[API] Fetch error:`, fetchError)
      if (fetchError instanceof Error) {
        if (fetchError.name === 'AbortError' || fetchError.message.includes('timeout')) {
          throw new Error('Server response timed out')
        }
        if (fetchError.message.includes('fetch')) {
          throw new Error('Network error connecting to API')
        }
      }
      throw fetchError
    }

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[API] Player not found: ${playerName}`)
        return []
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    let pageData: any
    try {
      const responseText = await response.text()
      console.log(`[API] Response received, length: ${responseText.length} characters`)
      pageData = JSON.parse(responseText)
    } catch (parseError) {
      console.error(`[API] JSON parsing error:`, parseError)
      throw new Error('Invalid API response format')
    }
    
    console.log(`[API] Response structure:`, Object.keys(pageData))
    
    // Extract decks from response
    if (pageData.Items && Array.isArray(pageData.Items)) {
      allDecks = allDecks.concat(pageData.Items)
      console.log(`[API] Page ${pageCount + 1}: received ${pageData.Items.length} decks`)
    } else {
      console.warn(`[API] Response does not contain Items or Items is not an array`)
      console.log(`[API] Type of Items:`, typeof pageData.Items)
      console.log(`[API] First 500 characters of response:`, JSON.stringify(pageData).substring(0, 500))
    }

    // Pagination: if LastEvaluatedKey exists, get next pages
    while (
      pageData.LastEvaluatedKey && 
      lastPK !== pageData.LastEvaluatedKey.PK &&
      pageCount < maxPages
    ) {
      lastPK = pageData.LastEvaluatedKey.PK
      const nextUrl = `${API_BASE_URL}/deck/app?inclPve=true&username=${encodedName}&exclusiveStartKeyPK=${encodeURIComponent(pageData.LastEvaluatedKey.PK)}&exclusiveStartKeySK=${encodeURIComponent(pageData.LastEvaluatedKey.SK)}`
      
      console.log(`[API] Requesting next page: ${pageCount + 2}`)
      
      try {
        response = await fetch(nextUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SolForge-Fusion-Deck-Viewer/1.0',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        })
      } catch (fetchError) {
        console.error(`[API] Fetch error for page ${pageCount + 2}:`, fetchError)
        break
      }

      if (!response.ok) {
        console.log(`[API] Error fetching page ${pageCount + 2}: ${response.status}`)
        break
      }

      try {
        const responseText = await response.text()
        pageData = JSON.parse(responseText)
      } catch (parseError) {
        console.error(`[API] JSON parsing error on page ${pageCount + 2}:`, parseError)
        break
      }
      
      pageCount++

      if (pageData.Items && Array.isArray(pageData.Items)) {
        allDecks = allDecks.concat(pageData.Items)
        console.log(`[API] Page ${pageCount + 1}: received ${pageData.Items.length} decks`)
      } else {
        console.warn(`[API] Page ${pageCount + 1}: response does not contain Items`)
        break
      }
    }

    console.log(`[API] Total ${allDecks.length} decks received over ${pageCount + 1} page(s)`)
    
    if (allDecks.length === 0) {
      console.log(`[API] No decks found for player: ${playerName}`)
      return []
    }
    
    // Normalize decks, filtering invalid ones
    // For each deck, try to fetch detailed information if cardList is not available
    const normalizedDecks = await Promise.all(
      allDecks.map(async (deck, index) => {
        try {
          let deckData = deck
          
          // If deck doesn't have cardList, try to fetch detailed info
          if (!deck.cardList && deck.id) {
            console.log(`[API] Fetching detailed info for deck ${deck.id}`)
            const details = await fetchDeckDetails(deck.id)
            if (details && details.cardList) {
              deckData = { ...deck, cardList: details.cardList }
            }
          }
          
          const normalized = normalizeDeck(deckData)
          // Log tag information for debugging
          if (normalized.tags) {
            const tagCount = typeof normalized.tags === 'object' && !Array.isArray(normalized.tags)
              ? Object.keys(normalized.tags).length
              : 0
            if (tagCount > 0) {
              console.log(`[API] Deck "${normalized.name}" has ${tagCount} tag(s)`)
            }
          }
          return normalized
        } catch (error) {
          console.warn(`[API] Error normalizing deck ${index}:`, error)
          return null
        }
      })
    )
    
    const validDecks = normalizedDecks.filter((deck): deck is ApiDeck => deck !== null)
    
    const decksWithTags = validDecks.filter(d => d.tags && typeof d.tags === 'object' && Object.keys(d.tags).length > 0)
    const decksWithCardList = validDecks.filter(d => {
      if (Array.isArray(d.cards) && d.cards.length > 0) {
        return typeof d.cards[0] === 'object' && d.cards[0] !== null
      }
      return false
    })
    console.log(`[API] Successfully normalized ${validDecks.length} out of ${allDecks.length} decks`)
    console.log(`[API] Decks with tags: ${decksWithTags.length}`)
    console.log(`[API] Decks with full card data (cardList): ${decksWithCardList.length}`)
    
    return validDecks
  } catch (error) {
    console.error(`[API] Error fetching decks:`, error)
    throw error
  }
}


/**
 * Convert card ID to readable name
 * Example: "s3nn1arrogant-butcher" -> "Arrogant Butcher"
 * Example: "s4-a6gasoaunb61bcrbl8bngbp8byzcf4" -> try to extract name from ID
 */
export function formatCardName(cardId: string): string {
  if (!cardId) return 'Unknown Card'
  
  // If ID contains only random characters, return as is
  if (/^[a-z0-9]{20,}$/i.test(cardId)) {
    return cardId
  }
  
  // Remove set prefix (e.g., "s3nn1", "s4-", "s3-")
  let name = cardId.replace(/^s\d+[a-z]*\d*[-_]?/i, '')
  
  // If nothing remains after removing prefix, return original
  if (!name || name.length < 2) {
    return cardId
  }
  
  // Replace hyphens and underscores with spaces
  name = name.replace(/[-_]/g, ' ')
  
  // Remove multiple spaces
  name = name.replace(/\s+/g, ' ').trim()
  
  // Capitalize first letter of each word
  name = name.split(' ')
    .map(word => {
      if (word.length === 0) return ''
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .filter(word => word.length > 0)
    .join(' ')
  
  return name || cardId
}

/**
 * Generates the image URL for a card based on its ID and level.
 * Format: https://sfwmedia11453-main.s3.amazonaws.com/public/cards/resized/{cardId}_{level}.jpg
 * 
 * @param cardId - Card ID (e.g., "s3nn1dissipating-spectre")
 * @param level - Card level (1, 2, or 3). Defaults to 1.
 * @returns Image URL for the card at the specified level
 */
export function getCardImageUrl(cardId: string, level: number = 1, isForgeborn: boolean = false): string {
  if (!cardId) return ''
  
  // Clean ID from special characters and ensure lowercase
  let cleanId = cardId.replace(/[^a-z0-9-]/gi, '').toLowerCase()
  
  // Forgeborn cards use format: {cardId}.jpg from /public/cards/ (not resized)
  // The cardId already contains the full identifier (e.g., "s3nn1cercee321")
  if (isForgeborn) {
    const forgebornBaseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards'
    return `${forgebornBaseUrl}/${cleanId}.jpg`
  }
  
  // Regular cards use format: {cardId}_1.jpg, {cardId}_2.jpg, {cardId}_3.jpg from /public/cards/resized/
  const baseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards/resized'
  // Ensure level is between 1 and 3
  const cardLevel = Math.max(1, Math.min(3, level))
  
  return `${baseUrl}/${cleanId}_${cardLevel}.jpg`
}

/**
 * Generates image URLs for all three levels of a card.
 * 
 * @param cardId - Card ID
 * @param isForgeborn - Whether this is a Forgeborn card
 * @returns Array of image URLs for levels 1, 2, and 3 (or single URL for Forgeborn)
 */
export function getCardImageUrls(cardId: string, isForgeborn: boolean = false): string[] {
  if (isForgeborn) {
    // Forgeborn uses single image with all levels
    return [getCardImageUrl(cardId, 1, true)]
  }
  return [1, 2, 3].map(level => getCardImageUrl(cardId, level, false))
}

/**
 * Получить информацию о карте по её ID
 */
export interface CardInfo {
  id: string
  name: string
  imageUrl: string
  type?: string
  faction?: string
  rarity?: string
  cardType?: string
  [key: string]: any // Allow additional properties
}

/**
 * Determine card type from card data or ID
 * Uses cardType and rarity fields from API
 */
function determineCardType(cardId: string, cardData?: any): string | undefined {
  // Check rarity first - if it's "Solbind", the card is a Solbind card
  if (cardData?.rarity === 'Solbind' || cardData?.rarity === 'solbind') {
    // Solbind cards can be spells or creatures, but they're categorized as Solbind
    return 'solbind'
  }
  
  // Get cardType from cardData (most reliable)
  const cardType = cardData?.cardType || cardData?.type || cardData?.card_type
  
  if (cardType) {
    const type = String(cardType).toLowerCase()
    if (type.includes('forgeborn')) return 'forgeborn'
    if (type.includes('spell')) return 'spell'
    if (type.includes('creature')) return 'creature'
    return type
  }
  
  // Fallback: try to determine from card ID or name patterns
  const lowerId = cardId.toLowerCase()
  const name = (cardData?.name || formatCardName(cardId)).toLowerCase()
  
  // Check for forgeborn indicators
  if (lowerId.includes('forgeborn') || name.includes('forgeborn') ||
      name.includes('cercee')) {
    return 'forgeborn'
  }
  
  // Check for spell indicators
  if (lowerId.includes('spell') || name.includes('spell')) {
    return 'spell'
  }
  
  // Default to creature if no other type found
  return 'creature'
}

export function getCardInfo(cardId: string, cardData?: any): CardInfo {
  const name = cardData?.name || formatCardName(cardId)
  const imageUrl = cardData?.imageUrl || cardData?.image || getCardImageUrl(cardId)
  const type = determineCardType(cardId, cardData)
  
  return {
    id: cardId,
    name,
    imageUrl,
    type,
    faction: cardData?.faction,
    rarity: cardData?.rarity,
    cardType: cardData?.cardType,
    // Preserve all additional data from cardData
    ...cardData,
  }
}

/**
 * Get player decks by nickname
 * 
 * Implemented based on Apps Script code from Google Sheets
 * Uses real SolForge Fusion API endpoint
 * 
 * @param playerName - player nickname
 * @returns array of player decks
 */
export async function getPlayerDecks(playerName: string): Promise<ApiDeck[]> {
  if (!playerName || !playerName.trim()) {
    throw new Error('Player nickname cannot be empty')
  }

  const trimmedName = playerName.trim()

  console.log(`[API] ===== Starting deck search for player: ${trimmedName} =====`)

  try {
    // Use real API endpoint from Apps Script
    const decks = await fetchDecksFromAPI(trimmedName)
    
    if (decks.length > 0) {
      console.log(`[API] ===== SUCCESS: Found ${decks.length} decks =====`)
      return decks
    } else {
      console.log(`[API] ===== No decks found for player: ${trimmedName} =====`)
      return []
    }
  } catch (error) {
    console.error(`[API] ===== ERROR fetching decks:`, error)
    throw error
  }
}
