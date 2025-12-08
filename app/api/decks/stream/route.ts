import { NextRequest } from 'next/server'
import { fetchFusedDecksFromAPI, getPlayerDecks, getCardInfo } from '@/lib/api'
import { logWithTimestamp } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Helper to send SSE events
const writeEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: any) => {
  const encoder = new TextEncoder()
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  controller.enqueue(encoder.encode(payload))
}

const collectTags = (deck: any): string[] => {
  const tagsSet = new Set<string>()

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

const buildTagPayload = (decks: any[], fused: any[]) => {
  const uniqueTags = new Set<string>()
  const uniqueCardNames = new Set<string>()
  const perDeck: Record<string, string[]> = {}
  const allDecks = [...decks, ...fused]

  allDecks.forEach((deck) => {
    const deckTags = collectTags(deck)
    deckTags.forEach((t) => uniqueTags.add(t))
    if (deck.id) {
      perDeck[deck.id] = deckTags
    }

    if (deck.cards && Array.isArray(deck.cards)) {
      deck.cards.forEach((card: any, idx: number) => {
        const cardInfo =
          typeof card === 'string'
            ? getCardInfo(card)
            : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
        if (cardInfo?.name && cardInfo.name.trim()) {
          uniqueCardNames.add(cardInfo.name)
        }
      })
    }
  })

  return {
    uniqueTags: Array.from(uniqueTags).sort(),
    uniqueCardNames: Array.from(uniqueCardNames).sort(),
    perDeck,
  }
}

export async function GET(request: NextRequest) {
  const playerName = request.nextUrl.searchParams.get('player')

  if (!playerName || !playerName.trim()) {
    return new Response('Player parameter is required', { status: 400 })
  }

  // Incremental tag aggregation state
  const tagState = {
    uniqueTags: new Set<string>(),
    uniqueCardNames: new Set<string>(),
    perDeck: {} as Record<string, string[]>,
    seenDecks: new Set<string>(),
    queue: Promise.resolve(),
  }

  const processDeckBatch = async (decks: any[], includePerDeck: boolean) => {
    const batchSize = 25
    for (let i = 0; i < decks.length; i += batchSize) {
      const slice = decks.slice(i, i + batchSize)
      slice.forEach((deck) => {
        if (!deck || typeof deck !== 'object') return
        const id = deck.id || deck.deckId
        if (id && tagState.seenDecks.has(id)) {
          return
        }
        if (id) tagState.seenDecks.add(id)

        const deckTags = collectTags(deck)
        if (includePerDeck && id) {
          tagState.perDeck[id] = deckTags
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
      })
      await new Promise<void>((resolve) => {
        if (typeof setImmediate !== 'undefined') {
          setImmediate(resolve)
        } else {
          setTimeout(resolve, 0)
        }
      })
    }
  }

  const enqueueTags = (decks: any[], options: { includePerDeck: boolean; onDone?: () => void }) => {
    tagState.queue = tagState.queue
      .then(() => processDeckBatch(decks, options.includePerDeck))
      .then(() => {
        options.onDone?.()
      })
      .catch((err) => {
        console.warn('[API /decks/stream] Tag aggregation error:', err)
      })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      writeEvent(controller, 'start', { player: playerName })

      try {
        let totalSoFar = 0
        writeEvent(controller, 'progress', {
          message: 'Requesting decks...',
          page: 0,
          received: 0,
          totalSoFar,
        })

        const { decks: regular, meta } = await getPlayerDecks(playerName, {
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
                onDone: () => {
                  writeEvent(controller, 'tags', {
                    phase: 'partial',
                    page,
                    uniqueTags: Array.from(tagState.uniqueTags),
                    uniqueCardNames: Array.from(tagState.uniqueCardNames),
                    // perDeck omitted in partial to reduce payload size
                  })
                },
              })
            }
          },
        })

        writeEvent(controller, 'regular-complete', {
          regularCount: regular.length,
          regularPages: meta.pages ?? meta.regularPages ?? 1,
        })

        // Start preparing tags from regular decks while fused decks are loading (non-blocking)
        enqueueTags(regular, {
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

        const fused = await fetchFusedDecksFromAPI(playerName).then((result) => {
          writeEvent(controller, 'fused', {
            fusedCount: result.length,
          })
          enqueueTags(result, {
            includePerDeck: true,
          })
          return result
        })

        // Final tag payload with both regular and fused decks
        await tagState.queue
        const tagPayload = {
          uniqueTags: Array.from(tagState.uniqueTags).sort(),
          uniqueCardNames: Array.from(tagState.uniqueCardNames).sort(),
          perDeck: tagState.perDeck,
        }
        writeEvent(controller, 'tags', { ...tagPayload, phase: 'final' })

        writeEvent(controller, 'done', {
          regular,
          fused,
          meta: {
            ...meta,
            fusedCount: fused.length,
            regularPages: meta.pages ?? meta.regularPages ?? 1,
            fusedPages: fused.length > 0 ? 1 : 0,
          },
          tags: tagPayload,
        })
        controller.close()
      } catch (error) {
        console.error('[API /decks/stream] Error:', error)
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
