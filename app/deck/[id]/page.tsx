'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Container, Loader, Paper, Stack, Text, Title, Button, Group } from '@mantine/core'
import { IconArrowLeft, IconHash } from '@tabler/icons-react'
import { BackgroundElements } from '@/components/BackgroundElements'
import { Header } from '@/components/Header'
import { DeckDetails } from '@/components/DeckDetails'
import type { Deck } from '@/store/deckStore'

export default function DeckPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const deckId = Array.isArray(params?.id) ? params.id[0] : params?.id
  const [deck, setDeck] = useState<Deck | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        setDeck(json.deck as Deck)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load deck')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [deckId])

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
                <Text className="text-red-300">Не удалось загрузить колоду: {error}</Text>
                <Group gap="sm">
                  <Button size="sm" onClick={() => router.refresh()}>
                    Повторить
                  </Button>
                  <Button size="sm" variant="light" onClick={handleClose}>
                    Назад
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
          allDecks={[deck]}
        />
      )}
    </main>
  )
}
