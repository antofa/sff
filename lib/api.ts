/**
 * Utilities for working with SolForge Fusion API
 * 
 * Implemented based on Apps Script code from Google Sheets
 * API endpoint: https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/deck/app
 */
import { logWithTimestamp } from './logger'

// Base URL for SolForge Fusion API (from Apps Script)
const API_BASE_URL = 'https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day
type CacheEntry<T> = { expiresAt: number; data: T }
const regularDeckCache = new Map<string, CacheEntry<ApiDeck[]>>()
const fusedDeckCache = new Map<string, CacheEntry<ApiDeck[]>>()

const getCached = (cache: Map<string, CacheEntry<ApiDeck[]>>, key: string) => {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.data
}

const setCached = (cache: Map<string, CacheEntry<ApiDeck[]>>, key: string, data: ApiDeck[]) => {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data })
}

const appendDeckSearchLog = async (message: string) => {
  // Skip file logging in browser/runtime without fs and in production
  if (typeof window !== 'undefined') return
  if (process.env.NODE_ENV === 'production') return
  const timestamp = new Date().toISOString()
  const line = `${timestamp} [fused] ${message}\n`
  try {
    const { default: fs } = await import('fs/promises')
    const { default: path } = await import('path')
    const LOG_DIR = path.join(process.cwd(), 'logs')
    const fileName = `deck-search-${timestamp.slice(0, 10)}.log`
    const fullPath = path.join(LOG_DIR, fileName)
    await fs.mkdir(LOG_DIR, { recursive: true })
    await fs.appendFile(fullPath, line, 'utf8')
  } catch (err) {
    // Swallow file logging errors to avoid breaking the flow
    console.warn('[logger] appendDeckSearchLog failed:', err)
  }
}

const fusedLog = async (message: string) => {
  logWithTimestamp(message)
  await appendDeckSearchLog(message)
}

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
export function normalizeDeck(deck: any): ApiDeck {
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
  } else if (deck.cards && typeof deck.cards === 'object') {
    // Cards provided as an object map (common in /deck/app)
    cards = Object.values(deck.cards)
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

  // Extract expiry date (pExpiry/expireAt/etc.) and preserve separately
  const expireAtRaw =
    deck.expireAt ??
    deck.expire_at ??
    deck.expireDate ??
    deck.expire_date ??
    deck.pExpiry ??
    null

  return {
    id: String(id),
    name: deck.name || deck.deckName || 'Untitled',
    format: deck.format || deck.gameFormat,
    cards: cards,
    created: deck.created || deck.createdAt || deck.CreatedAt,
    expireAt: expireAtRaw || undefined,
    updatedAt: deck.UpdatedAt || deck.updatedAt || deck.updated_at,
    // Additional fields from API
    faction: deck.faction,
    forgebornId: deck.forgebornId || (deck.forgeborn && deck.forgeborn.id),
    forgeborn: deck.forgeborn, // Preserve full forgeborn object with abilities
    deckRank: deck.deckRank || deck.rank,
    digital: deck.digital,
    tags: normalizedTags,
    cardSetNo: deck.cardSetNo,
    cardSetId: deck.cardSetId,
    deckScore: deck.deckScore,
    elo: deck.elo,
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
export async function fetchDeckDetails(deckId: string): Promise<any> {
  try {
    const url = `${API_BASE_URL}/deck/${deckId}?inclCards=true&inclUsers=true`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SolForge-Fusion-Deck-Viewer/1.0',
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
      signal: AbortSignal.timeout(60000),
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

type DeckFetchMeta = {
  total: number
  pages: number
  regularPages?: number
  fusedPages?: number
}

type DeckFetchResult = {
  decks: ApiDeck[]
  meta: DeckFetchMeta
}

type DeckPageProgress = {
  page: number
  received: number
  totalSoFar: number
  items?: any[]
}

async function fetchDecksFromAPI(
  playerName: string,
  options?: {
    onPage?: (info: DeckPageProgress) => void
    force?: boolean
  }
): Promise<DeckFetchResult> {
  const encodedName = encodeURIComponent(playerName.toLowerCase())
  const url = `${API_BASE_URL}/deck/app?inclPve=true&username=${encodedName}&inclCards=true`
  
  logWithTimestamp(`[API] Requesting decks for player: ${playerName}`)
  logWithTimestamp(`[API] URL: ${url}`)

  let allDecks: any[] = []
  let lastPK = ""
  let pageCount = 0
  const maxPages = 100 // Protection against infinite loop
  const notifyPage = (info: DeckPageProgress) => {
    try {
      options?.onPage?.(info)
    } catch (err) {
      console.warn('[API] onPage callback error:', err)
    }
  }

  try {
    // First request
    let response: Response
    try {
      const force = options?.force ?? false
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SolForge-Fusion-Deck-Viewer/1.0',
        },
        signal: AbortSignal.timeout(60000),
      }
      if (force) {
        fetchOptions.cache = 'no-store'
        ;(fetchOptions as any).next = { revalidate: 0 }
      } else {
        ;(fetchOptions as any).next = { revalidate: 3600 }
      }
      response = await fetch(url, {
        ...fetchOptions,
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
        logWithTimestamp(`[API] Player not found: ${playerName}`)
        return { decks: [], meta: { total: 0, pages: 0 } }
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    let pageData: any
    try {
      const responseText = await response.text()
      logWithTimestamp(`[API] Response received, length: ${responseText.length} characters`)
      pageData = JSON.parse(responseText)
    } catch (parseError) {
      console.error(`[API] JSON parsing error:`, parseError)
      throw new Error('Invalid API response format')
    }
    
    logWithTimestamp(`[API] Response structure:`, Object.keys(pageData))
    
    // Extract decks from response
    if (pageData.Items && Array.isArray(pageData.Items)) {
      allDecks = allDecks.concat(pageData.Items)
      logWithTimestamp(`[API] Page ${pageCount + 1}: received ${pageData.Items.length} decks`)
      notifyPage({
        page: pageCount + 1,
        received: pageData.Items.length,
        totalSoFar: allDecks.length,
        items: pageData.Items,
      })
    } else {
      console.warn(`[API] Response does not contain Items or Items is not an array`)
      logWithTimestamp(`[API] Type of Items:`, typeof pageData.Items)
      logWithTimestamp(`[API] First 500 characters of response:`, JSON.stringify(pageData).substring(0, 500))
    }

    // Pagination: if LastEvaluatedKey exists, get next pages
    while (
      pageData.LastEvaluatedKey && 
      lastPK !== pageData.LastEvaluatedKey.PK &&
      pageCount < maxPages
    ) {
      lastPK = pageData.LastEvaluatedKey.PK
      const nextUrl = `${API_BASE_URL}/deck/app?inclPve=true&username=${encodedName}&inclCards=true&exclusiveStartKeyPK=${encodeURIComponent(pageData.LastEvaluatedKey.PK)}&exclusiveStartKeySK=${encodeURIComponent(pageData.LastEvaluatedKey.SK)}`
      
      logWithTimestamp(`[API] Requesting next page: ${pageCount + 2}`)
      
      try {
        response = await fetch(nextUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SolForge-Fusion-Deck-Viewer/1.0',
          },
          next: { revalidate: 3600 }, // Cache for 1 hour
      signal: AbortSignal.timeout(60000),
        })
      } catch (fetchError) {
        console.error(`[API] Fetch error for page ${pageCount + 2}:`, fetchError)
        break
      }

      if (!response.ok) {
        logWithTimestamp(`[API] Error fetching page ${pageCount + 2}: ${response.status}`)
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
        logWithTimestamp(`[API] Page ${pageCount + 1}: received ${pageData.Items.length} decks`)
        notifyPage({
          page: pageCount + 1,
          received: pageData.Items.length,
          totalSoFar: allDecks.length,
          items: pageData.Items,
        })
      } else {
        console.warn(`[API] Page ${pageCount + 1}: response does not contain Items`)
        break
      }
    }

    logWithTimestamp(`[API] Total ${allDecks.length} decks received over ${pageCount + 1} page(s)`)    
    
    if (allDecks.length === 0) {
      logWithTimestamp(`[API] No decks found for player: ${playerName}`)
      return { decks: [], meta: { total: 0, pages: pageCount + 1 } }
    }
    
    // Normalize decks, filtering invalid ones (avoid per-deck detail fetches)
    const missingCardListCount = allDecks.filter(d => !d.cardList).length
    if (missingCardListCount > 0) {
      logWithTimestamp(`[API] ${missingCardListCount} deck(s) missing cardList; skipping extra detail fetch to avoid thundering herd`)
    }

    // Normalize in-place without additional network calls
    const normalizedDecks = await Promise.all(
      allDecks.map(async (deck, index) => {
        try {
          const normalized = normalizeDeck(deck)
          // Log tag information for debugging
          if (normalized.tags) {
            const tagCount = typeof normalized.tags === 'object' && !Array.isArray(normalized.tags)
              ? Object.keys(normalized.tags).length
              : 0
            if (tagCount > 0) {
              logWithTimestamp(`[API] Deck "${normalized.name}" has ${tagCount} tag(s)`)
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
    logWithTimestamp(`[API] Successfully normalized ${validDecks.length} out of ${allDecks.length} decks`)
    logWithTimestamp(`[API] Decks with tags: ${decksWithTags.length}`)
    logWithTimestamp(`[API] Decks with full card data (cardList): ${decksWithCardList.length}`)

    // Caching for regular decks happens in getPlayerDecks; keep this function pure
    const meta: DeckFetchMeta = {
      total: validDecks.length,
      pages: Math.max(1, pageCount + 1),
    }

    return { decks: validDecks, meta }
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
  
  // Forgeborn cards use format: {cardId}.jpg from /public/cards/ (NOT resized)
  // The cardId should preserve spaces and be URL-encoded (e.g., "s1aa1steel rosetta134" -> "s1aa1steel%20rosetta134")
  // Note: For forgeborn, we try the original ID first (with dash if present), then fall back to space replacement
  // This is handled in loadSingleImage function in DeckDetails.tsx
  if (isForgeborn) {
    const forgebornBaseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards'
    // URL encode the cardId as-is (preserve original format, whether it has dash or space)
    const encodedCardId = encodeURIComponent(cardId)
    return `${forgebornBaseUrl}/${encodedCardId}.jpg`
  }
  
  // Check if this is a set 99 card (custom/promotional cards)
  // Set 99 cards may use different path or format
  const isSet99 = /^s99/i.test(cardId)
  
  if (isSet99) {
    // For set 99 cards, try both resized and non-resized paths
    // First try the standard resized path
    const baseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards/resized'
    // Clean ID but preserve more characters for set 99 (may have underscores or other chars)
    let cleanId = cardId.replace(/[^a-z0-9\-_]/gi, '').toLowerCase()
    const cardLevel = Math.max(1, Math.min(3, level))
    
    // Return resized path first (will try alternative in loadSingleImage if this fails)
    return `${baseUrl}/${cleanId}_${cardLevel}.jpg`
  }
  
  // Regular cards use format: {cardId}_1.jpg, {cardId}_2.jpg, {cardId}_3.jpg from /public/cards/resized/
  const baseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards/resized'
  // Clean ID from special characters and ensure lowercase for regular cards
  let cleanId = cardId.replace(/[^a-z0-9-]/gi, '').toLowerCase()
  // Ensure level is between 1 and 3
  const cardLevel = Math.max(1, Math.min(3, level))
  
  return `${baseUrl}/${cleanId}_${cardLevel}.jpg`
}

/**
 * Generate alternative URL for forgeborn card by replacing dash with space
 * Used as fallback if the original URL doesn't work
 */
export function getForgebornAlternativeUrl(cardId: string): string {
  if (!cardId) return ''
  const forgebornBaseUrl = 'https://sfwmedia11453-main.s3.amazonaws.com/public/cards'
  // Replace dash with space if it appears before a number (common pattern: "steel-rosetta134" -> "steel rosetta134")
  let processedCardId = cardId
  // Pattern: look for dash followed by lowercase letters and then numbers (e.g., "steel-rosetta134")
  processedCardId = processedCardId.replace(/([a-z])-([a-z]+)(\d+)/gi, '$1 $2$3')
  // URL encode the cardId to preserve spaces as %20
  const encodedCardId = encodeURIComponent(processedCardId)
  return `${forgebornBaseUrl}/${encodedCardId}.jpg`
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
 * Fetch card info by ID
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
  // For Forgeborn cards, prefer title over name
  // Check if it's a Forgeborn card first
  const isForgeborn = cardData?.cardType?.toLowerCase().includes('forgeborn') ||
                     cardData?.type?.toLowerCase().includes('forgeborn') ||
                     determineCardType(cardId, cardData) === 'forgeborn'
  
  // Use title for Forgeborn, name for other cards
  const name = isForgeborn 
    ? (cardData?.title || cardData?.name || formatCardName(cardId))
    : (cardData?.name || cardData?.title || formatCardName(cardId))
  
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
    // Preserve all additional data from cardData (including title)
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
/**
 * Fetch fused decks from API
 * 
 * @param playerName - player nickname
 * @returns array of fused deck data
 */
export async function fetchFusedDecksFromAPI(
  playerName: string,
  options?: { force?: boolean; onPage?: (info: { page: number; received: number; totalSoFar: number; pageSize?: number }) => void }
): Promise<ApiDeck[]> {
  const startedAt = Date.now()
  // Build a quick lookup of regular decks by id from cache to avoid extra network calls
  const cachedRegularById = new Map<string, ApiDeck>()
  for (const [, entry] of regularDeckCache) {
    entry.data.forEach(deck => {
      if (deck.id) {
        cachedRegularById.set(deck.id, deck)
      }
    })
  }
  const cacheKey = playerName.trim().toLowerCase()
  const force = options?.force ?? false
  const cached = force ? null : getCached(fusedDeckCache, cacheKey)
  if (cached) {
    logWithTimestamp(`[API] Returning fused decks from cache for ${playerName} (${cached.length})`)
    return cached
  }
  if (force) {
    fusedDeckCache.delete(cacheKey)
  }

  const encodedName = encodeURIComponent(playerName.toLowerCase())
  const pageSize = 200
  const url = `${API_BASE_URL}/fuseddeck/app?pageSize=${pageSize}&username=${encodedName}`
  
  await fusedLog(`[API] Requesting fused decks for player: ${playerName}`)
  await fusedLog(`[API] URL: ${url}`)

  try {
    const fetchOptions: RequestInit = {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SolForge-Fusion-Deck-Viewer/1.0',
      },
      signal: AbortSignal.timeout(60000),
    }
    if (force) {
      fetchOptions.cache = 'no-store'
      ;(fetchOptions as any).next = { revalidate: 0 }
    } else {
      ;(fetchOptions as any).next = { revalidate: 3600 }
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      if (response.status === 404) {
        logWithTimestamp(`[API] Fused decks not found for player: ${playerName}`)
        return []
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const responseText = await response.text()
    await fusedLog(`[API] Fused decks response received, length: ${responseText.length} characters`)
    const pageData = JSON.parse(responseText)
    const parsedAt = Date.now()
    await fusedLog(`[API] Fused decks parsed in ${parsedAt - startedAt}ms`)
    
    // Extract fused decks from response
    const fusedDecks: any[] = []
    if (pageData.Items && Array.isArray(pageData.Items)) {
      await fusedLog(`[API] Received ${pageData.Items.length} fused decks`)
      if (options?.onPage) {
        options.onPage({
          page: pageData.page ?? 1,
          pageSize: pageData.pageSize ?? pageData.Items.length,
          received: pageData.Items.length,
          totalSoFar: pageData.total ?? pageData.Items.length,
        })
      }
      
      // Normalize each fused deck
      for (const fusedDeck of pageData.Items) {
        // A fused deck contains two regular decks in myDecks array
        // We need to merge them into a single deck representation
        if (fusedDeck.myDecks && Array.isArray(fusedDeck.myDecks) && fusedDeck.myDecks.length >= 2) {
          const deck1 = fusedDeck.myDecks[0]
          const deck2 = fusedDeck.myDecks[1]
          
          // Combine cards from both decks
          // For now, we'll need to fetch full deck details to get all cards
          // But we can create a normalized structure first
          const normalizedFusedDeck: any = {
            id: fusedDeck.id || `fused-${fusedDeck.name}`,
            name: fusedDeck.name || 'Unnamed Fused Deck',
            format: 'Fused',
            created: fusedDeck.CreatedAt || fusedDeck.UpdatedAt,
            updatedAt: fusedDeck.UpdatedAt || fusedDeck.updatedAt,
            faction: deck1.faction || deck2.faction, // Primary faction (first deck)
            forgebornId: fusedDeck.currentForgebornId || deck1.forgeborn?.id || deck2.forgeborn?.id,
            forgeborn: deck1.forgeborn || deck2.forgeborn,
            deckRank: fusedDeck.deckRank,
            digital: true, // Fused decks are digital
            tags: {},
            cardSetNo: undefined,
            deckScore: fusedDeck.deckScore,
            elo: fusedDeck.elo,
            // Store both deck IDs for later fetching
            fusedDeckIds: [deck1.id, deck2.id],
            myDecks: fusedDeck.myDecks,
            // Cards will be fetched separately if needed
            cards: [], // Will be populated when fetching deck details
          }
          
          fusedDecks.push(normalizedFusedDeck)
        } else {
          // Log if myDecks is missing or invalid
          console.warn(`[API] Fused deck ${fusedDeck.id || fusedDeck.name} missing myDecks:`, {
            hasMyDecks: !!fusedDeck.myDecks,
            myDecksType: typeof fusedDeck.myDecks,
            myDecksLength: Array.isArray(fusedDeck.myDecks) ? fusedDeck.myDecks.length : 'not array'
          })
        }
      }
    }
    
    // Fetch full deck details for each fused deck to get all cards
    // This is similar to how we handle regular decks
    const fusedDecksWithCards: ApiDeck[] = []
    let decksNeedingFetch = 0
    let embeddedCardDecks = 0
    let fallbackFetched = 0
    let fallbackFailed = 0
    let fallbackDurationMs = 0
    let cachedRegularHits = 0

    // Helper to collect cards from an embedded deck object without network
    const collectCards = (deckObj: any): any[] => {
      if (!deckObj) return []
      if (Array.isArray(deckObj.cardList) && deckObj.cardList.length > 0) return deckObj.cardList
      if (Array.isArray(deckObj.cards) && deckObj.cards.length > 0) return deckObj.cards
      if (Array.isArray(deckObj.cardIds) && deckObj.cardIds.length > 0) return deckObj.cardIds
      if (deckObj.cards && typeof deckObj.cards === 'object') return Object.values(deckObj.cards)
      return []
    }
    const collectCardsFromCachedRegular = (deckId?: string): any[] => {
      if (!deckId) return []
      const cached = cachedRegularById.get(deckId)
      if (!cached || !Array.isArray(cached.cards) || cached.cards.length === 0) return []
      return cached.cards
    }

    for (const fusedDeck of fusedDecks) {
      const allCards: any[] = []
      const enrichedMyDecks: any[] = Array.isArray(fusedDeck.myDecks) ? [] : []

      // Prefer embedded myDecks data (fast, no network)
      if (Array.isArray(fusedDeck.myDecks)) {
        // If fusedDeckIds are missing, build them from myDecks so downstream logic can still work
        if (!Array.isArray(fusedDeck.fusedDeckIds) || fusedDeck.fusedDeckIds.length === 0) {
          fusedDeck.fusedDeckIds = fusedDeck.myDecks
            .map((d: any) => d?.id)
            .filter((id: any): id is string => Boolean(id))
        }

        for (const d of fusedDeck.myDecks) {
          const cards = collectCards(d)
          let cardSource = 'embedded'
          if (cards.length > 0) {
            allCards.push(...cards)
            enrichedMyDecks.push(d)
          } else if (d?.id) {
            const cachedCards = collectCardsFromCachedRegular(d.id)
            if (cachedCards.length > 0) {
              allCards.push(...cachedCards)
              const cachedDeck = cachedRegularById.get(d.id)
              enrichedMyDecks.push(cachedDeck ? { ...cachedDeck, id: d.id } : d)
              cachedRegularHits++
              cardSource = 'cached'
            } else {
              enrichedMyDecks.push(d)
            }
          }
        }
        if (enrichedMyDecks.length === fusedDeck.myDecks.length) {
          fusedDeck.myDecks = enrichedMyDecks
        }
        if (allCards.length > 0) {
          embeddedCardDecks++
        }
      }

      // Try cached regular decks by fusedDeckIds if still empty
      if (allCards.length === 0 && Array.isArray(fusedDeck.fusedDeckIds)) {
        for (const id of fusedDeck.fusedDeckIds) {
          const cachedCards = collectCardsFromCachedRegular(id)
          if (cachedCards.length > 0) {
            allCards.push(...cachedCards)
            cachedRegularHits++
          }
        }
        if (allCards.length > 0) {
          embeddedCardDecks++
        }
      }

      // If still no cards, fetch fused deck details from API as fallback (even when fusedDeckIds are absent)
      if (allCards.length === 0) {
        decksNeedingFetch++
        const fetchStarted = Date.now()
        const details = await fetchDeckDetails(String(fusedDeck.id))
        fallbackDurationMs += Date.now() - fetchStarted
        if (details) {
          fallbackFetched++
          const detailedCards = collectCards(details)
          if (detailedCards.length > 0) {
            allCards.push(...detailedCards)
          }
          // Enrich fused deck with extra fields from detail response
          if (details.myDecks) {
            fusedDeck.myDecks = details.myDecks
          }
          if (details.fusedDeckIds) {
            fusedDeck.fusedDeckIds = details.fusedDeckIds
          }
          if (!fusedDeck.tags && details.tags) {
            fusedDeck.tags = details.tags
          }
        } else {
          fallbackFailed++
        }

        if (fallbackFetched > 0 && fallbackFetched % 25 === 0) {
          await fusedLog(
            `[API] Fused fallback progress: fetched ${fallbackFetched} of ${decksNeedingFetch} (failed ${fallbackFailed}), time ${fallbackDurationMs}ms`
          )
        }
      }
      
      // Remove duplicates (based on card ID)
      const uniqueCards = new Map<string, any>()
      allCards.forEach(card => {
        const cardId = typeof card === 'string' ? card : (card.id || card.cardId)
        if (cardId && !uniqueCards.has(cardId)) {
          uniqueCards.set(cardId, card)
        }
      })
      
      fusedDeck.cards = Array.from(uniqueCards.values())
      
      // Add forgeborn if not already in cards
      if (fusedDeck.forgeborn && fusedDeck.forgeborn.id) {
        const forgebornInCards = fusedDeck.cards.some((card: any) => {
          const cardId = typeof card === 'string' ? card : card.id
          return cardId === fusedDeck.forgeborn.id || cardId === fusedDeck.forgebornId
        })
        if (!forgebornInCards) {
          fusedDeck.cards = [fusedDeck.forgeborn, ...fusedDeck.cards]
        }
      }
      
      // Normalize deck but preserve fused deck specific fields
      const normalized = normalizeDeck(fusedDeck)
      // Preserve myDecks and fusedDeckIds for fused decks
      const normalizedWithFusedData: any = {
        ...normalized,
        myDecks: fusedDeck.myDecks,
        fusedDeckIds: fusedDeck.fusedDeckIds
      }

      fusedDecksWithCards.push(normalizedWithFusedData)
    }

    if (decksNeedingFetch > 0) {
      await fusedLog(`[API] Fused decks missing embedded cards: ${decksNeedingFetch} (fallback fetch attempted via detail API)`)
      await fusedLog(
        `[API] Fused fallback summary: embedded=${embeddedCardDecks}, cachedRegular=${cachedRegularHits}, fetched=${fallbackFetched}, failed=${fallbackFailed}, duration=${fallbackDurationMs}ms`
      )
    }
    await fusedLog(
      `[API] Fused decks normalization finished in ${Date.now() - startedAt}ms (total=${fusedDecksWithCards.length})`
    )
    
    return fusedDecksWithCards
  } catch (error) {
    console.error(`[API] Error fetching fused decks:`, error)
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error('Server response timed out')
      }
      if (error.message.includes('fetch')) {
        throw new Error('Network error connecting to API')
      }
    }
    throw error
  }
}

export async function getPlayerDecks(
  playerName: string,
  options?: {
    onPage?: (info: DeckPageProgress) => void
    force?: boolean
  }
): Promise<DeckFetchResult> {
  if (!playerName || !playerName.trim()) {
    throw new Error('Player nickname cannot be empty')
  }

  const trimmedName = playerName.trim()
  const cacheKey = trimmedName.toLowerCase()
  const force = options?.force ?? false
  const cached = force ? null : getCached(regularDeckCache, cacheKey)
  if (cached) {
    logWithTimestamp(`[API] Returning regular decks from cache for ${trimmedName} (${cached.length})`)
    options?.onPage?.({
      page: 1,
      received: cached.length,
      totalSoFar: cached.length,
    })
    return {
      decks: cached,
      meta: {
        total: cached.length,
        pages: 1,
      },
    }
  }
  if (force) {
    regularDeckCache.delete(cacheKey)
  }

  logWithTimestamp(`[API] ===== Starting deck search for player: ${trimmedName} =====`)

  try {
    // Use real API endpoint from Apps Script
    const { decks, meta } = await fetchDecksFromAPI(trimmedName, { onPage: options?.onPage, force })
    
    if (decks.length > 0) {
      logWithTimestamp(`[API] ===== SUCCESS: Found ${decks.length} decks =====`)
      setCached(regularDeckCache, cacheKey, decks)
      return { decks, meta }
    } else {
      logWithTimestamp(`[API] ===== No decks found for player: ${trimmedName} =====`)
      setCached(regularDeckCache, cacheKey, [])
      return {
        decks: [],
        meta: { total: 0, pages: meta.pages || 1 },
      }
    }
  } catch (error) {
    console.error(`[API] ===== ERROR fetching decks:`, error)
    throw error
  }
}
