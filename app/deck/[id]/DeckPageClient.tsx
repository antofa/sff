'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Container, Loader, Paper, Stack, Text, Title, Button, Group } from '@mantine/core'
import { IconArrowLeft, IconHash } from '@tabler/icons-react'
import { BackgroundElements } from '@/components/BackgroundElements'
import { Header } from '@/components/Header'
import { DeckDetails } from '@/components/DeckDetails'
import type { Deck } from '@/store/deckStore'
import { addComputedFields } from '@/store/deckStore'

export default function DeckPageClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const deckId = Array.isArray(params?.id) ? params.id[0] : params?.id
  const [deck, setDeck] = useState<Deck | null>(null)
  const [allDecks, setAllDecks] = useState<Deck[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sourcesLoadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!deckId) return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/deck/${deckId}`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json.error || 'Failed to load deck')
        }
        const rawDeck = json.deck as Deck
        const enriched = addComputedFields(rawDeck)

        const enrichedSources =
          Array.isArray((rawDeck as any)?.myDecks) && (rawDeck as any).myDecks.length > 0
            ? (rawDeck as any).myDecks
                .filter((d: any): d is Deck => !!d && typeof d === 'object')
                .map((d: Deck) => addComputedFields(d))
            : []

        setDeck(
          enrichedSources.length > 0
            ? { ...enriched, myDecks: enrichedSources }
            : enriched
        )

        setAllDecks([enriched, ...enrichedSources])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load deck')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [deckId])

  useEffect(() => {
    sourcesLoadedRef.current = null
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
            const res = await fetch(`/api/deck/${id}`)
            const json = await res.json()
            if (!res.ok || !json?.deck) return
            addDeck(json.deck as Deck)
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
      router.push('/all-decks')
      return
    }

    const referrer = document.referrer || ''
    const sameOriginReferrer = referrer.startsWith(window.location.origin)

    if (sameOriginReferrer) {
      router.back()
      return
    }

    router.push('/all-decks')
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
              router.push(`/deck/${d.id}`)
            } else if (parent?.id && parent.id !== deckId) {
              router.push(`/deck/${parent.id}`)
            }
          }}
          allDecks={allDecks.length > 0 ? allDecks : [deck]}
        />
      )}
    </main>
  )
}
