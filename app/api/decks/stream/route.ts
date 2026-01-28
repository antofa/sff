import { appendFile, mkdir } from 'fs/promises'
import path from 'path'
import { NextRequest } from 'next/server'
import { fetchFusedDecksFromAPI, getPlayerDecks, getCardInfo } from '@/lib/api'
import { computeCreatureTypesForDeck } from '@/lib/creatureTypes'
import { logWithTimestamp } from '@/lib/logger'
import { getLogDirs, shouldFallbackToTmp } from '@/lib/logPaths'
import { pruneOldLogs } from '@/lib/logRotation'

export const dynamic = 'force-dynamic'

// Helper to send SSE events
const writeEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: any) => {
  const encoder = new TextEncoder()
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  try {
    controller.enqueue(encoder.encode(payload))
  } catch (err: any) {
    // Ignore attempts to write after the stream is closed; log others for diagnostics
    if (err?.code !== 'ERR_INVALID_STATE') {
      console.warn('[API /decks/stream] failed to enqueue SSE event', { event, err })
    }
  }
}

const fallbackCardNameFromId = (id: string): string => {
  if (!id) return ''
  const withSpaces = id.replace(/[_-]/g, ' ')
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
}

const formatSetLabel = (value?: string | number | null): string | null => {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'b1') return 'B1'
  if (lower === 'b2') return 'B2'
  if (lower === 'd0') return 'S99'
  if (/^s\d+/.test(lower)) return lower.toUpperCase()
  if (/^\d+$/.test(lower)) return `S${lower}`
  return text.toUpperCase()
}

const getBSetFromCard = (card: any): 'B1' | 'B2' | null => {
  if (!card) return null
  if (typeof card === 'string') {
    if (/^b2_/i.test(card)) return 'B2'
    if (/^b1_/i.test(card)) return 'B1'
    return null
  }
  const cardSetId = card.cardSetId || card.CardSetId || card.SK || card.sk
  const cardId = card.id || card.cardId || card.name
  const setLower = cardSetId ? String(cardSetId).toLowerCase() : ''
  if (setLower === 'b2') return 'B2'
  if (setLower === 'b1') return 'B1'
  if (cardId && /^b2_/i.test(cardId)) return 'B2'
  if (cardId && /^b1_/i.test(cardId)) return 'B1'
  return null
}

const getBSetFromCards = (cards: any[]): 'B1' | 'B2' | null => {
  let found: 'B1' | 'B2' | null = null
  for (const card of cards) {
    const bSet = getBSetFromCard(card)
    if (bSet === 'B2') return 'B2'
    if (bSet === 'B1') found = 'B1'
  }
  return found
}

const deriveSetFromId = (id?: string | null): string | null => {
  if (!id || typeof id !== 'string') return null
  const lower = id.toLowerCase()
  if (lower.startsWith('b1-') || lower.startsWith('b1_')) return 'B1'
  if (lower.startsWith('b2-') || lower.startsWith('b2_')) return 'B2'
  if (lower.startsWith('s1-')) return 'S1'
  if (lower.startsWith('s2-')) return 'S2'
  if (lower.startsWith('s3-')) return 'S3'
  if (lower.startsWith('s4-')) return 'S4'
  return null
}

const getDeckSetTag = (deck: any): string | null => {
  if (!deck) return null
  const explicit = formatSetLabel(deck.cardSetNo ?? deck.cardSetId ?? null)
  if (explicit) return explicit

  if (Array.isArray(deck.cards)) {
    const bSet = getBSetFromCards(deck.cards)
    if (bSet) return bSet
  }

  if (Array.isArray(deck.myDecks)) {
    let fallback: string | null = null
    for (const src of deck.myDecks) {
      if (!src) continue
      const srcExplicit = formatSetLabel(src.cardSetNo ?? src.cardSetId ?? null)
      if (srcExplicit) return srcExplicit
      if (Array.isArray(src.cards)) {
        const bSet = getBSetFromCards(src.cards)
        if (bSet === 'B2') return 'B2'
        if (bSet === 'B1') fallback = 'B1'
      }
    }
    if (fallback) return fallback
  }

  return formatSetLabel(deriveSetFromId(deck.id))
}

const collectTags = (deck: any): string[] => {
  const tagsSet = new Set<string>()

  const setTag = getDeckSetTag(deck)
  if (setTag) tagsSet.add(setTag)

  if (deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
    Object.entries(deck.tags).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return
      if (key === 'none' && (!value || value === '')) return
      if (typeof value === 'string' && value.trim() === '') return

      let tagText: string | null = null
      if (typeof value === 'string' && value.trim() !== '') {
        tagText = value.trim()
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        tagText = String(value)
      } else if (key && key !== 'none' && !key.startsWith('tag_')) {
        tagText = key
      }

      if (tagText && tagText.trim() !== '') {
        tagsSet.add(tagText.trim())
      }
    })
  }

  if (deck.cards && Array.isArray(deck.cards)) {
    deck.cards.forEach((card: any) => {
      if (card && typeof card === 'object') {
        const provides = card.provides || card.Provides
        if (provides) {
          if (typeof provides === 'string') {
            provides.split(',').forEach((p: string) => {
              const trimmed = p.trim()
              if (trimmed) tagsSet.add(trimmed)
            })
          } else if (Array.isArray(provides)) {
            provides.forEach((p: string) => {
              if (p && typeof p === 'string') {
                const trimmed = p.trim()
                if (trimmed) tagsSet.add(trimmed)
              }
            })
          }
        }
      }
    })
  }

  return Array.from(tagsSet)
}

const addCreatureTypes = (deck: any) => {
  try {
    const creatureType = computeCreatureTypesForDeck(deck, getCardInfo)
    return { ...deck, creatureType }
  } catch (err) {
    console.warn('[API /decks/stream] Failed to compute creature types', err)
    return deck
  }
}

const buildTagPayload = (decks: any[], fused: any[]) => {
  const uniqueTags = new Set<string>()
  const uniqueCardNames = new Set<string>()
  const perDeck: Record<string, string[]> = {}
  const perDeckCreatureTypes: Record<string, Record<string, number>> = {}
  const allDecks = [...decks, ...fused]

  allDecks.forEach((deck) => {
    const deckTags = collectTags(deck)
    deckTags.forEach((t) => uniqueTags.add(t))
    if (deck.id) {
      perDeck[deck.id] = deckTags
      const ctype =
        (deck as any).creatureType &&
        typeof (deck as any).creatureType === 'object'
          ? (deck as any).creatureType
          : computeCreatureTypesForDeck(deck, getCardInfo)
      if (ctype && typeof ctype === 'object') {
        perDeckCreatureTypes[deck.id] = ctype
      }
    }

    if (deck.cards && Array.isArray(deck.cards)) {
      deck.cards.forEach((card: any, idx: number) => {
        let cardName: string | null = null
        if (typeof card === 'string') {
          cardName = fallbackCardNameFromId(card)
        } else if (card && typeof card === 'object') {
          cardName = (card as any).name || (card as any).title || (card as any).cardTitle || (card as any).cardId || null
          if (!cardName) {
            const id = (card as any).id || (card as any).cardId || `card-${idx}`
            cardName = fallbackCardNameFromId(id)
          }
        }
        if (cardName && cardName.trim()) {
          uniqueCardNames.add(cardName.trim())
        }
      })
    }
  })

  return {
    uniqueTags: Array.from(uniqueTags).sort(),
    uniqueCardNames: Array.from(uniqueCardNames).sort(),
    perDeck,
    perDeckCreatureTypes,
  }
}

export async function GET(request: NextRequest) {
  const playerName = request.nextUrl.searchParams.get('player')
  const force = request.nextUrl.searchParams.get('force') === '1' || request.nextUrl.searchParams.get('force') === 'true'

  if (!playerName || !playerName.trim()) {
    return new Response('Player parameter is required', { status: 400 })
  }

  const t0 = Date.now()
  const elapsed = () => `${Date.now() - t0}ms`

  const { primary: primaryLogsDir, fallback: fallbackLogsDir } = getLogDirs()
  void pruneOldLogs(primaryLogsDir)
  if (fallbackLogsDir !== primaryLogsDir) {
    void pruneOldLogs(fallbackLogsDir)
  }
  let currentLogsDir = primaryLogsDir
  const buildLogPath = () => path.join(currentLogsDir, `deck-search-${new Date().toISOString().slice(0, 10)}.log`)
  let logFilePath = buildLogPath()
  const logToFile = async (message: string) => {
    const line = `${new Date().toISOString()} [stream] player=${playerName} ${message} (elapsed=${elapsed()})\n`
    try {
      await appendFile(logFilePath, line)
    } catch (error: any) {
      const isFallbackAttempt = currentLogsDir === fallbackLogsDir
      const shouldFallback = shouldFallbackToTmp(error) && !isFallbackAttempt

      if (shouldFallback) {
        currentLogsDir = fallbackLogsDir
        logFilePath = buildLogPath()
      }

      if (error?.code === 'ENOENT' || shouldFallback) {
        try {
          await mkdir(path.dirname(logFilePath), { recursive: true })
          await appendFile(logFilePath, line)
        } catch (nestedErr) {
          console.error('[stream] failed to write log file after fallback', nestedErr)
        }
      } else {
        console.error('[stream] failed to write log file', error)
      }
    }
  }

  const logStage = (msg: string) => {
    logWithTimestamp(`[stream] player=${playerName} ${msg} (elapsed=${elapsed()})`)
    void logToFile(msg)
  }

  // Incremental tag aggregation state
  const tagState = {
    uniqueTags: new Set<string>(),
    uniqueCardNames: new Set<string>(),
    perDeck: {} as Record<string, string[]>,
    perDeckCreatureTypes: {} as Record<string, Record<string, number>>,
    seenDecks: new Set<string>(),
    queue: Promise.resolve(),
    processedDecks: 0,
    totalDecks: undefined as number | undefined,
  }

const processDeckBatch = async (
  controller: ReadableStreamDefaultController<Uint8Array>,
  decks: any[],
  includePerDeck: boolean,
  countProgress: boolean = true
  ) => {
    const batchSize = 25
    for (let i = 0; i < decks.length; i += batchSize) {
      const slice = decks.slice(i, i + batchSize)
      slice.forEach((deck) => {
        if (!deck || typeof deck !== 'object') {
          if (countProgress) tagState.processedDecks += 1
          return
        }
        const id = deck.id || deck.deckId
        const isDuplicate = countProgress && id && tagState.seenDecks.has(id)
        if (isDuplicate) {
          // Keep progress moving even if tags already counted for this deck
          tagState.processedDecks += 1
          return
        }
        if (countProgress && id) tagState.seenDecks.add(id)

        const deckTags = collectTags(deck)
        if (includePerDeck && id) {
          tagState.perDeck[id] = deckTags
          const creatureTypes =
            (deck as any).creatureType && typeof (deck as any).creatureType === 'object'
              ? (deck as any).creatureType
              : computeCreatureTypesForDeck(deck, getCardInfo)
          if (creatureTypes && typeof creatureTypes === 'object') {
            tagState.perDeckCreatureTypes[id] = creatureTypes
          }
        }
        deckTags.forEach((t) => tagState.uniqueTags.add(t))

        if (deck.cards && Array.isArray(deck.cards)) {
          deck.cards.forEach((card: any, idx: number) => {
            const cardInfo =
              typeof card === 'string'
                ? getCardInfo(card)
                : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
            if (cardInfo?.name && cardInfo.name.trim()) {
              tagState.uniqueCardNames.add(cardInfo.name.trim())
            }
          })
        }
        if (countProgress) {
          tagState.processedDecks += 1
        }
      })
      if (countProgress) {
        // Emit incremental progress for tags
        const processedForDisplay =
          tagState.totalDecks !== undefined
            ? Math.min(tagState.processedDecks, tagState.totalDecks)
            : tagState.processedDecks
        writeEvent(controller, 'tags', {
          phase: 'partial',
          processedDecks: processedForDisplay,
          totalDecks: tagState.totalDecks,
          uniqueTags: Array.from(tagState.uniqueTags),
          uniqueCardNames: Array.from(tagState.uniqueCardNames),
        })
      }
      await new Promise<void>((resolve) => {
        if (typeof setImmediate !== 'undefined') {
          setImmediate(resolve)
        } else {
          setTimeout(resolve, 0)
        }
      })
    }
  }

  const enqueueTags = (
    decks: any[],
    options: { includePerDeck: boolean; countProgress?: boolean; onDone?: () => void }
  ) => {
    tagState.queue = tagState.queue
      .then(() => processDeckBatch(controllerRef, decks, options.includePerDeck, options.countProgress ?? true))
      .then(() => {
        options.onDone?.()
      })
      .catch((err) => {
        console.warn('[API /decks/stream] Tag aggregation error:', err)
      })
  }

  // Controller ref to use inside tag queue
  let controllerRef: ReadableStreamDefaultController<Uint8Array>

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller
      writeEvent(controller, 'start', { player: playerName })
      logStage('stream start')

      try {
        let totalSoFar = 0
        type PlayerDecksResult = Awaited<ReturnType<typeof getPlayerDecks>>
        let meta: PlayerDecksResult['meta'] | undefined
        writeEvent(controller, 'progress', {
          message: 'Requesting decks...',
          page: 0,
          received: 0,
          totalSoFar,
        })

        const { decks: regular, meta: fetchedMeta } = await getPlayerDecks(playerName, {
          onPage: ({ page, received, totalSoFar: running, items }) => {
            totalSoFar = running
            writeEvent(controller, 'progress', {
              message: `Received page ${page} (${received} decks)`,
              page,
              received,
              totalSoFar,
            })

            // Incremental tag aggregation per page (counts only to keep payload light)
            if (items && Array.isArray(items)) {
              enqueueTags(items, {
                includePerDeck: false,
                countProgress: false, // partial per-page tag hints; do not advance progress counter
                onDone: () => {
                  writeEvent(controller, 'tags', {
                    phase: 'partial',
                    page,
                    uniqueTags: Array.from(tagState.uniqueTags),
                    uniqueCardNames: Array.from(tagState.uniqueCardNames),
                    processedDecks: tagState.processedDecks,
                    totalDecks: tagState.totalDecks,
                    // perDeck omitted in partial to reduce payload size
                  })
                },
              })
            }
          },
          force,
        })

        const regularWithTypes = Array.isArray(regular) ? regular.map(addCreatureTypes) : []

        meta = fetchedMeta
        if (!meta) {
          throw new Error('Missing metadata from getPlayerDecks')
        }

        logStage(`regular fetch done count=${regularWithTypes.length} pages=${meta.pages ?? meta.regularPages ?? 1}`)

        tagState.totalDecks = regularWithTypes.length
        writeEvent(controller, 'regular-complete', {
          regularCount: regularWithTypes.length,
          regularPages: meta.pages ?? meta.regularPages ?? 1,
        })

        // Start preparing tags from regular decks while fused decks are loading (non-blocking)
        enqueueTags(regularWithTypes, {
          includePerDeck: true,
          onDone: () => {
            writeEvent(controller, 'tags', {
              phase: 'regular',
              uniqueTags: Array.from(tagState.uniqueTags),
              uniqueCardNames: Array.from(tagState.uniqueCardNames),
              // perDeck omitted here; final event will include it
            })
          },
        })

        writeEvent(controller, 'progress', {
          message: 'Fetching fused decks...',
          page: meta.pages ?? meta.regularPages ?? 1,
          received: 0,
          totalSoFar,
        })

        let fusedTotalSoFar = 0
        const fusedProgress = (info: { page?: number; received?: number; totalSoFar?: number; pageSize?: number }) => {
          fusedTotalSoFar = info.totalSoFar ?? fusedTotalSoFar
          writeEvent(controller, 'fused', {
            page: info.page,
            pageSize: info.pageSize,
            received: info.received,
            totalSoFar: fusedTotalSoFar,
            message:
              info.page !== undefined && info.received !== undefined
                ? `Fused page ${info.page} (${info.received} decks)`
                : undefined,
          })
        }

        const fused = await fetchFusedDecksFromAPI(playerName, {
          force,
          onPage: ({ page, received, totalSoFar: running, pageSize }) => {
            fusedProgress({ page, received, totalSoFar: running, pageSize })
          },
        }).then((result) => {
          fusedProgress({ totalSoFar: result.length })
          const fusedWithTypes = Array.isArray(result) ? result.map(addCreatureTypes) : []
          tagState.totalDecks = (regularWithTypes?.length || 0) + fusedWithTypes.length
          enqueueTags(fusedWithTypes, {
            includePerDeck: true,
          })
          writeEvent(controller, 'fused-complete', {
            fusedCount: fusedWithTypes.length,
            fusedPages: fusedWithTypes.length > 0 ? 1 : 0,
          })
          logStage(`fused fetch done count=${fusedWithTypes.length}`)
          return fusedWithTypes
        })

        // Send decks immediately so fetch step can complete on client
        writeEvent(controller, 'decks-ready', {
          regular: regularWithTypes,
          fused,
          meta: {
            ...meta,
            fusedCount: fused.length,
            regularPages: meta.pages ?? meta.regularPages ?? 1,
            fusedPages: fused.length > 0 ? 1 : 0,
          },
        })
        logStage('decks-ready emitted to client')

        // Final tag payload with both regular and fused decks (blocking until tags complete)
        logStage('tag aggregation waiting for queue to finish')
        await tagState.queue
        const tagPayload = {
          uniqueTags: Array.from(tagState.uniqueTags).sort(),
          uniqueCardNames: Array.from(tagState.uniqueCardNames).sort(),
          perDeck: tagState.perDeck,
          perDeckCreatureTypes: tagState.perDeckCreatureTypes,
        }
        writeEvent(controller, 'tags', { ...tagPayload, phase: 'final' })
        logStage(`tag aggregation done tags=${tagPayload.uniqueTags.length} cards=${tagPayload.uniqueCardNames.length}`)

        writeEvent(controller, 'done', {
          meta: {
            ...meta,
            fusedCount: fused.length,
            regularPages: meta.pages ?? meta.regularPages ?? 1,
            fusedPages: fused.length > 0 ? 1 : 0,
          },
          tags: tagPayload,
        })
        logStage('done emitted')
        controller.close()
        return
      } catch (error) {
        console.error('[API /decks/stream] Error:', error)
        logStage('stream error')
        writeEvent(controller, 'error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
