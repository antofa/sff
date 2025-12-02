'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconBrandDiscord, IconHash, IconSearch, IconUser, IconUsersGroup } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { BackgroundElements } from '@/components/BackgroundElements'
import { DeckDetails } from '@/components/DeckDetails'
import { Header } from '@/components/Header'
import type { Deck } from '@/store/deckStore'

type PlayerSummary = {
  player_name: string
  display_name: string | null
  discord_username: string | null
  deck_count: number
  last_seen: string | null
  latest_deck_id: string | null
  latest_deck_name: string | null
  latest_fused_id?: string | null
  latest_fused_name?: string | null
}

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return '—'
  return new Date(ts).toLocaleString()
}

export default function PlayersPage() {
  const [player, setPlayer] = useState('')
  const [discord, setDiscord] = useState('')
  const [deckId, setDeckId] = useState('')
  const [players, setPlayers] = useState<PlayerSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [deckModalOpen, setDeckModalOpen] = useState(false)
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null)
  const [deckLoading, setDeckLoading] = useState(false)
  const [playerDecks, setPlayerDecks] = useState<Deck[]>([])
  const [playerFusedDecks, setPlayerFusedDecks] = useState<Deck[]>([])
  const [modalPlayer, setModalPlayer] = useState<string | null>(null)
  const [parentFusedDeck, setParentFusedDeck] = useState<Deck | null>(null)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (player.trim()) params.set('player', player.trim())
    if (discord.trim()) params.set('discord', discord.trim())
    if (deckId.trim()) params.set('deckId', deckId.trim())
    return params.toString()
  }, [player, discord, deckId])

  const fetchPlayers = useCallback(
    async (options?: { silent?: boolean }) => {
      setLoading(true)
      if (!options?.silent) {
        setHasSearched(true)
      }
      try {
        const res = await fetch(`/api/players${queryString ? `?${queryString}` : ''}`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json.error || 'Failed to load players')
        }
        setPlayers(json.players ?? [])
        if (!options?.silent && (!json.players || json.players.length === 0)) {
          notifications.show({
            title: 'No results',
            message: 'Players matching your query were not found.',
            color: 'yellow',
          })
        }
      } catch (error) {
        console.error('[Players] Fetch error:', error)
        notifications.show({
          title: 'Ошибка',
          message: error instanceof Error ? error.message : 'Не удалось загрузить игроков',
          color: 'red',
        })
      } finally {
        setLoading(false)
      }
    },
    [queryString]
  )

  useEffect(() => {
    fetchPlayers({ silent: true }).catch(() => {
      /* ошибки уже показаны выше */
    })
  }, [fetchPlayers])

  const openDeckModal = useCallback(async (id: string | null | undefined, options?: { playerName?: string | null; parentDeck?: Deck | null }) => {
    if (!id) return
    setDeckModalOpen(true)
    setDeckLoading(true)
    setSelectedDeck(null)
    setParentFusedDeck(options?.parentDeck ?? null)

    const incomingPlayer = options?.playerName?.trim() || null
    const modalPlayerNormalized = modalPlayer?.toLowerCase() ?? null

    // Если открываем колоду другого игрока, сбрасываем кешированные данные
    if (incomingPlayer && modalPlayerNormalized && incomingPlayer.toLowerCase() !== modalPlayerNormalized) {
      setPlayerDecks([])
      setPlayerFusedDecks([])
    }

    try {
      const res = await fetch(`/api/deck/${id}`)
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load deck')
      }

      const deckData = json.deck as Deck
      setSelectedDeck(deckData)

      const ownerFromDeck = (deckData as any)?.playerName || (deckData as any)?.player_name || null
      const resolvedOwner = incomingPlayer || ownerFromDeck || modalPlayer || null

      if (resolvedOwner) {
        const normalizedOwner = resolvedOwner.toLowerCase()
        if (!modalPlayerNormalized || normalizedOwner !== modalPlayerNormalized) {
          setModalPlayer(resolvedOwner)
          setPlayerDecks([])
          setPlayerFusedDecks([])
        }

        if (!modalPlayerNormalized || normalizedOwner !== modalPlayerNormalized || (playerDecks.length === 0 && playerFusedDecks.length === 0)) {
          try {
            const playerDecksRes = await fetch(`/api/decks?player=${encodeURIComponent(resolvedOwner)}`)
            const playerDecksJson = await playerDecksRes.json()

            if (playerDecksRes.ok) {
              const regularDecks: Deck[] = Array.isArray(playerDecksJson?.regular)
                ? playerDecksJson.regular
                : Array.isArray(playerDecksJson)
                  ? playerDecksJson
                  : []
              const fusedDecks: Deck[] = Array.isArray(playerDecksJson?.fused) ? playerDecksJson.fused : []

              setPlayerDecks(regularDecks)
              setPlayerFusedDecks(fusedDecks)
            } else {
              console.warn('[Players] Failed to load player decks for modal:', playerDecksJson?.error || playerDecksJson)
            }
          } catch (err) {
            console.error('[Players] Error fetching player decks for modal:', err)
          }
        }
      } else {
        setModalPlayer(null)
        setPlayerDecks([])
        setPlayerFusedDecks([])
      }
    } catch (error) {
      console.error('[Players] Failed to load deck:', error)
      notifications.show({
        title: 'Ошибка',
        message: error instanceof Error ? error.message : 'Не удалось загрузить колоду',
        color: 'red',
      })
      setDeckModalOpen(false)
    } finally {
      setDeckLoading(false)
    }
  }, [modalPlayer, playerDecks.length, playerFusedDecks.length])

  const closeDeckModal = useCallback(() => {
    setDeckModalOpen(false)
    setSelectedDeck(null)
    setDeckLoading(false)
    setParentFusedDeck(null)
  }, [])

  const handleReset = () => {
    setPlayer('')
    setDiscord('')
    setDeckId('')
    setPlayers([])
    setHasSearched(false)
    setPlayerDecks([])
    setPlayerFusedDecks([])
    setParentFusedDeck(null)
    setModalPlayer(null)
  }

  const allDecksForModal = useMemo<Deck[]>(() => {
    const map = new Map<string, Deck>()
    const addDeck = (deck: Deck | null) => {
      if (deck && deck.id) {
        map.set(deck.id, deck)
      }
    }
    playerDecks.forEach(addDeck)
    playerFusedDecks.forEach(addDeck)
    addDeck(selectedDeck)
    addDeck(parentFusedDeck)
    return Array.from(map.values())
  }, [playerDecks, playerFusedDecks, selectedDeck, parentFusedDeck])

  return (
    <main className="min-h-screen relative overflow-hidden">
      <BackgroundElements />
      <Header />
      <Container size="xl" className="relative z-10 py-12">
        <Stack gap="xl">
          <div>
            <Title order={2} className="text-white">Players</Title>
            <Text className="text-gray-400">
              Find players by in-game name, Discord, or deck ID.
            </Text>
          </div>

          <Paper
            p="md"
            className="bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-lg"
          >
            <Stack gap="md">
              <Group grow align="flex-end">
                <TextInput
                  label="Player name"
                  placeholder="In-game nickname"
                  value={player}
                  onChange={(e) => setPlayer(e.currentTarget.value)}
                  leftSection={<IconUser size={16} />}
                  classNames={{ input: 'bg-slate-700/40 text-white' }}
                />
                <TextInput
                  label="Discord"
                  placeholder="Discord username"
                  value={discord}
                  onChange={(e) => setDiscord(e.currentTarget.value)}
                  leftSection={<IconBrandDiscord size={16} />}
                  classNames={{ input: 'bg-slate-700/40 text-white' }}
                />
                <TextInput
                  label="Deck ID"
                  placeholder="e.g. ST-1234..."
                  value={deckId}
                  onChange={(e) => setDeckId(e.currentTarget.value)}
                  leftSection={<IconHash size={16} />}
                  classNames={{ input: 'bg-slate-700/40 text-white' }}
                />
              </Group>
              <Group justify="flex-end" gap="sm">
                <Button variant="light" onClick={handleReset} disabled={loading}>
                  Reset
                </Button>
                <Button onClick={() => fetchPlayers()} loading={loading} leftSection={<IconSearch size={16} />}>
                  Search players
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
              {players.length === 0 && hasSearched && (
                <Paper
                  p="xl"
                  className="bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-lg"
                >
                  <Stack gap="xs" align="center">
                    <IconUsersGroup size={28} className="text-gray-400" />
                    <Text className="text-gray-300">No players found for this query.</Text>
                    <Text size="sm" className="text-gray-400" ta="center">
                      Try adjusting the nickname, Discord name, or deck id.
                    </Text>
                  </Stack>
                </Paper>
              )}

            {players.length > 0 && (
              <Stack gap="md">
                {players.map((item) => (
                  <Paper
                    key={`${item.player_name}-${item.discord_username ?? 'no-discord'}`}
                      p="md"
                      className="bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-lg"
                    >
                      <Stack gap={8}>
                        <Group justify="space-between" align="flex-start">
                          <div className="space-y-1">
                            <Group gap="sm">
                              <Title order={4} className="text-white">
                                {item.display_name || item.player_name}
                              </Title>
                              {item.discord_username && (
                                <Badge color="violet" leftSection={<IconBrandDiscord size={14} />}>
                                  {item.discord_username}
                                </Badge>
                              )}
                              <Badge color="blue" variant="light">
                                {item.deck_count} deck{item.deck_count === 1 ? '' : 's'}
                              </Badge>
                            </Group>
                            <Group gap="sm">
                              <Text size="sm" className="text-gray-300">
                                Last seen: {formatDate(item.last_seen)}
                              </Text>
                            </Group>
                            {(item.latest_fused_name || item.latest_deck_name) && (
                              <Text size="sm" className="text-gray-200">
                                {item.latest_fused_id ? 'Latest fused deck:' : 'Latest deck:'}{' '}
                                {item.latest_fused_id || item.latest_deck_id ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openDeckModal(item.latest_fused_id || item.latest_deck_id, {
                                        playerName: item.player_name,
                                        parentDeck: null,
                                      })
                                    }
                                    className="text-sf-secondary hover:underline"
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                  >
                                    {item.latest_fused_name || item.latest_deck_name}
                                  </button>
                                ) : (
                                  item.latest_fused_name || item.latest_deck_name
                                )}
                              </Text>
                            )}
                          </div>
                          <Button
                            component="a"
                            href={`/all-decks?player=${encodeURIComponent(item.player_name)}`}
                            variant="light"
                            size="sm"
                          >
                            Open decks
                          </Button>
                        </Group>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              )}
            </>
          )}
        </Stack>
      </Container>

      {deckModalOpen && deckLoading && !selectedDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Loader size="lg" color="blue" />
        </div>
      )}

      {selectedDeck && (
        <DeckDetails
          deck={selectedDeck}
          opened={deckModalOpen}
          onClose={closeDeckModal}
          onDeckClick={(deck, parent) => {
            const nextId = deck?.id || parent?.id
            const owner =
              (deck as any)?.playerName ||
              (parent as any)?.playerName ||
              (selectedDeck as any)?.playerName ||
              modalPlayer ||
              null

            if (nextId) {
              openDeckModal(nextId, { playerName: owner, parentDeck: parent ?? null })
            }
          }}
          allDecks={allDecksForModal}
          parentFusedDeck={parentFusedDeck}
        />
      )}
    </main>
  )
}
