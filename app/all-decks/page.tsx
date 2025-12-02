'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

type SavedDeck = {
  id?: string
  deck_id: string
  deck_name: string
  player_name: string
  faction?: string | null
  format?: string | null
  deck_rank?: string | null
  card_set_no?: string | null
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

export default function AllDecksPage() {
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

  const fetchDecks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      // fetch all to show full list in DeckList; backend supports paging but we want consistent view
      params.set('limit', '500')
      params.set('offset', '0')
      if (search.trim()) params.set('search', search.trim())
      if (player.trim()) params.set('player', player.trim())
      if (faction) params.set('faction', faction)
      if (format) params.set('format', format)
      if (onlyNft) params.set('isNft', 'true')

      const res = await fetch(`/api/saved-decks?${params.toString()}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json()
      setDecks(json.decks ?? [])
      setCount(json.count ?? 0)
    } catch (error) {
      console.error('[AllDecks] Fetch error:', error)
      setDecks([])
      setCount(0)
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
    // fetch happens via useEffect when deps change
  }

  const mappedDecks = useMemo<Deck[]>(() => {
    return decks.map((deck) => ({
      id: deck.deck_id,
      name: deck.deck_name,
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
      playerName: deck.player_name,
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
            <DeckList decks={regularDecks} fusedDecks={fusedDecks} />
          )}
        </Stack>
      </Container>
    </main>
  )
}
