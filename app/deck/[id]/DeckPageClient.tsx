'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Container, Loader, Paper, Stack, Text, Title, Button, Group } from '@mantine/core'
import { IconArrowLeft, IconHash } from '@tabler/icons-react'
import { BackgroundElements } from '@/components/BackgroundElements'
import { Header } from '@/components/Header'
import { DeckDetails } from '@/components/DeckDetails'
import type { Deck } from '@/types'
import { addComputedFields } from '@/store/deckStore'
import { fetchDeckFromApiCached } from '@/lib/clientDeckApi'

type DeckPageClientProps = {
  initialDeckId?: string
  initialDeck?: Deck | null
}

type DeckPageState = {
  deck: Deck
  allDecks: Deck[]
}

type DeckPageStateCacheEntry = {
  expiresAt: number
  data: DeckPageState
}

const DECK_PAGE_STATE_CACHE_TTL_MS = 10 * 60 * 1000
const DECK_PAGE_STATE_CACHE_MAX_ENTRIES = 120
const deckPageStateCache = new Map<string, DeckPageStateCacheEntry>()

const normalizeDeckStateCacheKey = (deckId: string) => deckId.toString().trim().toLowerCase()

const trimDeckPageStateCache = () => {
  while (deckPageStateCache.size > DECK_PAGE_STATE_CACHE_MAX_ENTRIES) {
    const oldestKey = deckPageStateCache.keys().next().value
    if (oldestKey === undefined) return
    deckPageStateCache.delete(oldestKey)
  }
}

const getCachedDeckPageState = (deckId: string): DeckPageState | null => {
  const key = normalizeDeckStateCacheKey(deckId)
  const cached = deckPageStateCache.get(key)
  if (!cached) return null
  if (cached.expiresAt < Date.now()) {
    deckPageStateCache.delete(key)
    return null
  }
  return cached.data
}

const setCachedDeckPageState = (deckId: string, state: DeckPageState) => {
  const key = normalizeDeckStateCacheKey(deckId)
  deckPageStateCache.delete(key)
  deckPageStateCache.set(key, {
    expiresAt: Date.now() + DECK_PAGE_STATE_CACHE_TTL_MS,
    data: state,
  })
  trimDeckPageStateCache()
}

const isSameDeckId = (left?: string | null, right?: string | null): boolean => {
  if (!left || !right) return false
  return normalizeDeckStateCacheKey(left) === normalizeDeckStateCacheKey(right)
}

const buildDeckStateFromRaw = (rawDeck: Deck) => {
  const enriched = addComputedFields(rawDeck)
  const enrichedSources =
    Array.isArray((rawDeck as any)?.myDecks) && (rawDeck as any).myDecks.length > 0
      ? (rawDeck as any).myDecks
          .filter((d: any): d is Deck => !!d && typeof d === 'object')
          .map((d: Deck) => addComputedFields(d))
      : []
  const enrichedDeck = enrichedSources.length > 0 ? { ...enriched, myDecks: enrichedSources } : enriched
  return { deck: enrichedDeck, allDecks: [enrichedDeck, ...enrichedSources] }
}

export default function DeckPageClient({ initialDeckId, initialDeck }: DeckPageClientProps) {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const routeDeckId = Array.isArray(params?.id) ? params.id[0] : params?.id
  const deckId = routeDeckId || initialDeckId
  const canUseInitialDeck = !!initialDeck && !!initialDeckId && (!routeDeckId || routeDeckId === initialDeckId)
  const initialState = canUseInitialDeck ? buildDeckStateFromRaw(initialDeck as Deck) : null
  const cachedState = deckId ? getCachedDeckPageState(deckId) : null
  const bootstrapState = cachedState ?? initialState

  const [deck, setDeck] = useState<Deck | null>(bootstrapState?.deck ?? null)
  const [allDecks, setAllDecks] = useState<Deck[]>(bootstrapState?.allDecks ?? [])
  const parentFusedFromQueryRaw = searchParams?.get('parentFused') || ''
  const parentFusedIdFromQuery = parentFusedFromQueryRaw.trim()
  const isCurrentDeckFused = String(((deck as any)?.format || '')).toLowerCase() === 'fused'
  const parentFusedDeck: Deck | null =
    parentFusedIdFromQuery && parentFusedIdFromQuery !== deckId && !isCurrentDeckFused
      ? ((allDecks.find((candidate) => candidate?.id === parentFusedIdFromQuery) as Deck | undefined) || {
          id: parentFusedIdFromQuery,
          name: 'Fused Deck',
          format: 'Fused',
        })
      : null
  const [loading, setLoading] = useState(!bootstrapState)
  const [error, setError] = useState<string | null>(null)
  const sourcesLoadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!deckId) return

    let cancelled = false

    const applyDeckState = (rawDeck: Deck) => {
      if (cancelled) return
      const nextState = buildDeckStateFromRaw(rawDeck)
      setDeck(nextState.deck)
      setAllDecks(nextState.allDecks)
    }

    const fetchFullInBackground = async () => {
      try {
        const fullDeck = (await fetchDeckFromApiCached(deckId, {
          timeoutMs: 12000,
          ttlMs: 6000,
        })) as Deck
        applyDeckState(fullDeck)
      } catch {
        // Keep fast payload on screen if full enrichment fails.
      }
    }

    const load = async () => {
      setError(null)
      const cachedForDeck = getCachedDeckPageState(deckId)
      if (cachedForDeck) {
        if (!cancelled) {
          setDeck(cachedForDeck.deck)
          setAllDecks(cachedForDeck.allDecks)
        }
        setLoading(false)
        void fetchFullInBackground()
        return
      }

      const hasMatchingInitialDeck = !!initialDeck && !!initialDeckId && initialDeckId === deckId

      if (hasMatchingInitialDeck) {
        applyDeckState(initialDeck as Deck)
        setLoading(false)
        void fetchFullInBackground()
        return
      }

      setLoading(true)
      try {
        const fastDeck = (await fetchDeckFromApiCached(deckId, {
          fast: true,
          timeoutMs: 12000,
          ttlMs: 6000,
        })) as Deck
        applyDeckState(fastDeck)
        setLoading(false)
        void fetchFullInBackground()
      } catch {
        try {
          const fullDeck = (await fetchDeckFromApiCached(deckId, {
            timeoutMs: 12000,
            ttlMs: 6000,
          })) as Deck
          applyDeckState(fullDeck)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load deck')
        } finally {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [deckId, initialDeck, initialDeckId])

  useEffect(() => {
    sourcesLoadedRef.current = null
  }, [deckId])

  useEffect(() => {
    if (!deckId || !deck?.id) return
    if (!isSameDeckId(deckId, deck.id)) return
    const normalizedAllDecks = allDecks.length > 0 ? allDecks : [deck]
    setCachedDeckPageState(deckId, {
      deck,
      allDecks: normalizedAllDecks,
    })
  }, [deckId, deck, allDecks])

  useEffect(() => {
    if (!deckId) return
    const encodedDeckId = encodeURIComponent(deckId)
    // Warm the OG route in the background so sharing is instant after opening the deck.
    void fetch(`/api/og/deck/${encodedDeckId}`, {
      method: 'GET',
      cache: 'force-cache',
      keepalive: true,
    }).catch(() => {
      // ignore prewarm failures
    })
  }, [deckId])

  useEffect(() => {
    const run = async () => {
      if (!deck) return
      const isFused = String((deck as any).format || '').toLowerCase() === 'fused'
      if (!isFused) {
        setAllDecks([deck])
        return
      }
      if (sourcesLoadedRef.current === deck.id) {
        return
      }
      sourcesLoadedRef.current = deck.id

      const collected: Deck[] = []
      const ids = new Set<string>()

      const addDeck = (d: Deck | null | undefined) => {
        if (!d || !d.id || ids.has(d.id)) return
        const enriched = d.computed ? d : addComputedFields(d)
        ids.add(enriched.id)
        collected.push(enriched)
      }

      if (Array.isArray((deck as any).myDecks)) {
        ;(deck as any).myDecks.forEach((d: Deck) => addDeck(d))
      }

      const fusedIds: string[] =
        (Array.isArray((deck as any).fusedDeckIds) && (deck as any).fusedDeckIds.filter(Boolean)) || []

      await Promise.all(
        fusedIds.map(async (id) => {
          if (!id || ids.has(id)) return
          try {
            const deckPayload = (await fetchDeckFromApiCached(id, {
              timeoutMs: 12000,
              ttlMs: 6000,
            })) as Deck
            addDeck(deckPayload)
          } catch {
            // ignore fetch errors; we still show whatever data we have
          }
        })
      )

      setAllDecks([deck, ...collected])
      if (collected.length > 0) {
        setDeck((prev) => (prev ? { ...prev, myDecks: collected } : prev))
      }
    }

    void run()
  }, [deck])

  const handleClose = () => {
    if (typeof window === 'undefined') {
      router.push('/')
      return
    }

    const referrer = document.referrer || ''
    const sameOriginReferrer = referrer.startsWith(window.location.origin)

    if (sameOriginReferrer) {
      router.back()
      return
    }

    router.push('/')
  }

  return (
    <main className="min-h-screen relative overflow-hidden">
      <BackgroundElements />
      <Header />
      <Container size="lg" className="relative z-10 py-8">
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={3} className="text-white flex items-center gap-2">
              <IconHash size={24} />
              Deck {deckId}
            </Title>
            <Button
              variant="light"
              leftSection={<IconArrowLeft size={16} />}
              onClick={handleClose}
            >
              Back
            </Button>
          </Group>

          {loading && (
            <Group justify="center" py="xl">
              <Loader size="lg" />
            </Group>
          )}

          {error && (
            <Paper
              p="md"
              className="bg-slate-800/60 backdrop-blur-md border border-red-500/40 rounded-lg"
            >
              <Stack gap="xs">
                <Text className="text-red-300">Failed to load deck: {error}</Text>
                <Group gap="sm">
                  <Button size="sm" onClick={() => router.refresh()}>
                    Retry
                  </Button>
                  <Button size="sm" variant="light" onClick={handleClose}>
                    Back
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Container>

      {deck && (
        <DeckDetails
          deck={deck}
          opened={true}
          onClose={handleClose}
          onDeckClick={(d, parent) => {
            if (d?.id && d.id !== deckId) {
              const parentId = parent?.id || ''
              const isParentFused =
                !!parentId && String(((parent as any)?.format || '')).toLowerCase() === 'fused'
              if (isParentFused) {
                router.push(`/deck/${encodeURIComponent(d.id)}?parentFused=${encodeURIComponent(parentId)}`)
                return
              }
              router.push(`/deck/${encodeURIComponent(d.id)}`)
            } else if (parent?.id && parent.id !== deckId) {
              router.push(`/deck/${encodeURIComponent(parent.id)}`)
            }
          }}
          allDecks={allDecks.length > 0 ? allDecks : [deck]}
          parentFusedDeck={parentFusedDeck}
        />
      )}
    </main>
  )
}
