'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useSearchParams } from 'next/navigation'
import { BackgroundElements } from '@/components/BackgroundElements'
import { Header } from '@/components/Header'
import { DeckList } from '@/components/DeckList'
import type { Deck } from '@/store/deckStore'

export const dynamic = 'force-dynamic'

type SavedDeck = {
  id?: string
  deck_id?: string
  deck_name?: string
  player_name?: string
  faction?: string | null
  format?: string | null
  deck_rank?: string | null
  card_set_no?: string | null
  card_set_id?: string | null
  deck_score?: number | null
  elo?: number | null
  is_fused?: boolean | null
  updated_at?: string | null
  cards?: any[] | null
  my_decks?: any[] | null
  fused_deck_ids?: string[] | null
  tags?: any
  created?: string | null
  forgeborn_id?: string | null
  forgeborn?: any
}

const factions = ['Alloyin', 'Uterra', 'Tempys', 'Nekrium']
const formats = ['Fused', 'Sole', 'Reconstructed', 'Standard'] // formats are free text, keep a small helper list

function AllDecksContent() {
  const searchParams = useSearchParams()
  const initialPlayer = searchParams.get('player') ?? ''
  const [decks, setDecks] = useState<SavedDeck[]>([])
  const [count, setCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')
  const [player, setPlayer] = useState<string>(initialPlayer)
  const [faction, setFaction] = useState<string | null>(null)
  const [format, setFormat] = useState<string | null>(null)
  const [onlyNft, setOnlyNft] = useState<boolean>(false)
  const [infoMessage, setInfoMessage] = useState<string | null>('Enter a player name to load decks.')

  const fetchDecks = useCallback(async () => {
    const playerName = player.trim()
    if (!playerName) {
      setDecks([])
      setCount(0)
      setInfoMessage('Enter a player name to load decks.')
      return
    }

    setLoading(true)
    setInfoMessage(null)
    try {
      const res = await fetch(`/api/decks?player=${encodeURIComponent(playerName)}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json()

      const regularDecks: any[] = Array.isArray(json?.regular) ? json.regular : []
      const fusedDecks: any[] = Array.isArray(json?.fused) ? json.fused : []
      const merged = [...regularDecks, ...fusedDecks]

      const normalized: SavedDeck[] = merged.map((deck: any) => ({
        id: deck.id,
        deck_id: deck.id,
        deck_name: deck.name,
        player_name: deck.playerName || deck.player_name || playerName,
        faction: deck.faction ?? null,
        format: deck.format ?? null,
        deck_rank: deck.deckRank ?? null,
        card_set_no: deck.cardSetNo ? String(deck.cardSetNo) : null,
        card_set_id: deck.cardSetId ?? null,
        deck_score: deck.deckScore ?? null,
        elo: deck.elo ?? null,
        is_fused: String(deck.format || '').toLowerCase() === 'fused' || Boolean(deck.is_fused),
        cards: Array.isArray(deck.cards) ? deck.cards : [],
        my_decks: Array.isArray(deck.myDecks) ? deck.myDecks : null,
        fused_deck_ids: Array.isArray(deck.fusedDeckIds) ? deck.fusedDeckIds : null,
        tags: deck.tags ?? null,
        created: deck.created ?? null,
        updated_at: deck.updatedAt ?? null,
        forgeborn_id: deck.forgebornId ?? null,
        forgeborn: deck.forgeborn ?? null,
      }))

      const searchText = search.trim().toLowerCase()
      const filtered = normalized.filter((deck) => {
        if (searchText) {
          const name = (deck.deck_name || '').toLowerCase()
          if (!name.includes(searchText)) return false
        }

        if (faction && (deck.faction || '').toLowerCase() !== faction.toLowerCase()) {
          return false
        }

        if (format && (deck.format || '').toLowerCase() !== format.toLowerCase()) {
          return false
        }

        if (onlyNft) {
          const rank = (deck.deck_rank || '').toLowerCase()
          const isNftLike = rank.includes('nft')
          if (!isNftLike) return false
        }

        return true
      })

      setDecks(filtered)
      setCount(filtered.length)
      if (filtered.length === 0) {
        setInfoMessage('No decks found with current filters.')
      }
    } catch (error) {
      console.error('[AllDecks] Fetch error:', error)
      setDecks([])
      setCount(0)
      setInfoMessage('Failed to load decks. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [search, player, faction, format, onlyNft])

  useEffect(() => {
    const playerFromUrl = searchParams.get('player') ?? ''
    setPlayer(prev => (prev === playerFromUrl ? prev : playerFromUrl))
  }, [searchParams])

  useEffect(() => {
    fetchDecks()
  }, [fetchDecks])

  const handleApplyFilters = () => {
    fetchDecks()
  }

  const handleReset = () => {
    setSearch('')
    setPlayer('')
    setFaction(null)
    setFormat(null)
    setOnlyNft(false)
    setInfoMessage('Enter a player name to load decks.')
    // fetch happens via useEffect when deps change
  }

  const mappedDecks = useMemo<Deck[]>(() => {
    return decks.map((deck) => ({
      id: deck.deck_id || deck.id || '',
      name: deck.deck_name || 'Untitled',
      faction: deck.faction ?? undefined,
      format: deck.format ?? undefined,
      deckRank: deck.deck_rank ?? undefined,
      cardSetNo: deck.card_set_no ?? undefined,
      cardSetId: deck.card_set_id ?? undefined,
      deckScore: deck.deck_score ?? undefined,
      elo: deck.elo ?? undefined,
      is_fused: deck.is_fused ?? undefined,
      fusedDeckIds: deck.fused_deck_ids ?? undefined,
      myDecks: deck.my_decks ?? undefined,
      cards: deck.cards ?? [],
      playerName: deck.player_name || undefined,
      created: deck.created ?? deck.updated_at ?? undefined,
      forgebornId: deck.forgeborn_id ?? undefined,
      forgeborn: deck.forgeborn ?? undefined,
      tags: deck.tags ?? undefined,
    } as Deck))
  }, [decks])

  const regularDecks = useMemo(
    () => mappedDecks.filter(d => d.format !== 'Fused' && !(d as any).is_fused),
    [mappedDecks]
  )
  const fusedDecks = useMemo(() => [], []) // fused decks are excluded from this view

  return (
    <main className="min-h-screen relative overflow-hidden">
      <BackgroundElements />
      <Header />
      <Container size="xl" className="relative z-10 py-12">
        <Stack gap="xl">
          <div>
            <Title order={2} className="text-white">All Saved Decks</Title>
            <Text className="text-gray-400">Browse decks saved from player searches.</Text>
          </div>

          <Paper
            p="md"
            className="bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-lg"
          >
            <Stack gap="md">
              <Group grow align="flex-end">
                <TextInput
                  label="Deck name"
                  placeholder="Search by deck name"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.currentTarget.value)
                  }}
                  leftSection={<IconSearch size={16} />}
                  classNames={{ input: 'bg-slate-700/40 text-white' }}
                />
                <TextInput
                  label="Player"
                  placeholder="Search by player"
                  value={player}
                  onChange={(e) => {
                    setPlayer(e.currentTarget.value)
                  }}
                  classNames={{ input: 'bg-slate-700/40 text-white' }}
                />
              </Group>
              <Group grow align="flex-end">
                <Select
                  label="Faction"
                  placeholder="Any"
                  data={factions}
                  clearable
                  value={faction}
                  onChange={(value) => {
                    setFaction(value)
                  }}
                  classNames={{ input: 'bg-slate-700/40 text-white' }}
                />
                <Select
                  label="Format"
                  placeholder="Any"
                  data={formats}
                  clearable
                  value={format}
                  onChange={(value) => {
                    setFormat(value)
                  }}
                  classNames={{ input: 'bg-slate-700/40 text-white' }}
                />
                <Stack gap={8}>
                  <Switch
                    label="NFT only"
                    checked={onlyNft}
                    onChange={(e) => {
                      setOnlyNft(e.currentTarget.checked)
                    }}
                  />
                </Stack>
              </Group>
              <Group justify="flex-end" gap="sm">
                <Button variant="light" onClick={handleReset}>
                  Reset
                </Button>
                <Button onClick={handleApplyFilters} loading={loading}>
                  Apply
                </Button>
              </Group>
            </Stack>
          </Paper>

          {loading ? (
            <Group justify="center" py="xl">
              <Loader size="lg" />
            </Group>
          ) : (
            <>
              {infoMessage && (
                <Paper p="md" className="bg-slate-800/50 border border-sf-primary/20 rounded-lg">
                  <Text className="text-gray-300">{infoMessage}</Text>
                </Paper>
              )}
              <DeckList decks={regularDecks} fusedDecks={fusedDecks} />
            </>
          )}
        </Stack>
      </Container>
    </main>
  )
}

export default function AllDecksPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen relative overflow-hidden">
          <BackgroundElements />
          <Header />
          <Container size="xl" className="relative z-10 py-12">
            <Group justify="center">
              <Loader />
            </Group>
          </Container>
        </main>
      }
    >
      <AllDecksContent />
    </Suspense>
  )
}
