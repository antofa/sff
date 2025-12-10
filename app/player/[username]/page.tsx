'use client'

import { use, useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { IconArrowLeft, IconBrandDiscord, IconCheck, IconCircleDashed, IconTrophy, IconWorld } from '@tabler/icons-react'
import { BackgroundElements } from '@/components/BackgroundElements'
import { Header } from '@/components/Header'
import { DeckList } from '@/components/DeckList'
import { useDeckStore } from '@/store/deckStore'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'

type PlayerProfile = {
  displayName?: string
  username?: string
  elo?: number
  xp?: number
  embers?: number
  gold?: number
  isActive?: boolean
  earnedRewards?: string[]
  achievements?: any
  quests?: Array<{
    difficulty: string
    questId: string
    description: string
    targetAmount: number
    currentAmount: number
    rewards: Array<{ type: string; amount: number }>
  }>
  playId?: string
  referralCode?: string
  tutorialStatus?: number
  campaignUnlockLevel?: number
  ascensionReclusa?: number
  freeDecksAwarded?: number
  xp_mt002?: number
  xp_mt_test?: number
  consumables?: Record<string, number>
  purchases?: Record<string, number>
  cosmetics?: string[]
  rewardAddress?: string
  botProtection?: boolean
  version?: string
  [key: string]: any
}

const formatNumber = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  return value.toLocaleString()
}

const getFactionAmounts = (profile: PlayerProfile) => {
  const factions = ['alloyin', 'uterra', 'tempys', 'nekrium'] as const
  const season = profile.achievements?.['Season 1']?.collectionBased
  const decks = season?.decks
  return factions.map((faction) => ({
    faction,
    amount: decks?.[faction]?.amount ?? 0,
  }))
}

const getRarityBands = (profile: PlayerProfile) => {
  const rarity = profile.achievements?.['Season 1']?.collectionBased?.rarity ?? {}
  const bands = ['rarity75', 'rarity80', 'rarity85', 'rarity90', 'rarity95', 'rarity99']
  return bands
    .map((key) => ({
      key,
      amount: rarity?.[key]?.amount ?? 0,
      goal25: rarity?.[key]?.decks25?.amount ?? 25,
      label: key.replace('rarity', 'RARITY '),
    }))
    .filter((b) => b.amount > 0 || b.key === 'rarity75')
}

const getTotalPoints = (profile: PlayerProfile) => profile.achievements?.totalPointsEarned ?? 0

const flattenAchievements = (profile: PlayerProfile) => {
  const entries: Array<{ category: string; label: string; data: any }> = []
  const seasons = profile.achievements ? Object.entries(profile.achievements) : []

  const pushEntries = (seasonLabel: string, category: string, obj: any) => {
    if (!obj) return
    Object.entries(obj).forEach(([key, value]) => {
      entries.push({ category: `${seasonLabel} · ${category}`, label: key, data: value })
    })
  }

  seasons.forEach(([seasonKey, seasonData]) => {
    if (!seasonData) return
    pushEntries(seasonKey, 'Collection', (seasonData as any).collectionBased?.decks)
    pushEntries(seasonKey, 'Rarity', (seasonData as any).collectionBased?.rarity)
    pushEntries(seasonKey, 'Community', (seasonData as any).communityBased)
    pushEntries(seasonKey, 'Play', (seasonData as any).playBased)
    pushEntries(seasonKey, 'Web3', (seasonData as any).web3Based)
    pushEntries(seasonKey, 'Purchase', (seasonData as any).purchaseBased)
    pushEntries(seasonKey, 'Daily', (seasonData as any).dailyEventBased)
  })

  return entries
}

const QuestList = ({ quests }: { quests: PlayerProfile['quests'] }) => {
  if (!quests || quests.length === 0) {
    return (
      <Text className="text-gray-400" size="sm">
        No active quests.
      </Text>
    )
  }

  return (
    <Stack gap="sm">
      {quests.map((quest) => {
        const progress = Math.min(100, Math.round((quest.currentAmount / quest.targetAmount) * 100))
        return (
          <Paper
            key={quest.questId}
            p="md"
            className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
          >
            <Stack gap={6}>
              <Group justify="space-between" align="center">
                <Text fw={600} className="text-white">
                  {quest.description}
                </Text>
                <Badge color="blue" variant="light">
                  {quest.difficulty}
                </Badge>
              </Group>
              <Progress value={progress} size="sm" />
              <Group justify="space-between">
                <Text size="sm" className="text-gray-300">
                  {quest.currentAmount} / {quest.targetAmount}
                </Text>
                <Group gap={6}>
                  {quest.rewards?.map((reward, idx) => (
                    <Badge key={idx} color="teal" variant="light">
                      {reward.type}: {reward.amount}
                    </Badge>
                  ))}
                </Group>
              </Group>
            </Stack>
          </Paper>
        )
      })}
    </Stack>
  )
}

export default function PlayerProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params)
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [playerProfileMeta, setPlayerProfileMeta] = useState<{
    player_name?: string | null
    display_name?: string | null
    discord_name?: string | null
  } | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const { decks, fusedDecks, loading: decksLoading, error: decksError, fetchDecks, clearDecks, progress } =
    useDeckStore()
  const [hasFetchedDecks, setHasFetchedDecks] = useState(false)
  const [deckSectionCollapsed, setDeckSectionCollapsed] = useState(true)
  const [progressVisible, setProgressVisible] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [forceRefresh, setForceRefresh] = useState(false)
  const isMountedRef = useRef(true)
  const activeUsernameRef = useRef(username)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      setPlayerProfileMeta(null)
      try {
        const res = await fetch(`https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/user/${encodeURIComponent(username)}`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.message || 'Failed to load profile')
        }
        setProfile(json)

        // Fetch metadata from our Supabase-backed API (player_profiles)
        fetch(`/api/players?player=${encodeURIComponent(username)}&limit=1`)
          .then((resp) => {
            if (!resp.ok) return null
            return resp.json()
          })
          .then((data) => {
            if (!data) return
            const first = data?.players?.[0]
            if (first) {
              setPlayerProfileMeta({
                player_name: first.player_name,
                display_name: first.display_name,
                discord_name: first.discord_name || null,
              })
            }
          })
          .catch(() => {
            /* ignore meta errors */
          })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
        setProfile(null)
      } finally {
        setLoading(false)
      }
    }
    load().catch(() => {
      /* already handled */
    })
  }, [username])

  useEffect(() => {
    activeUsernameRef.current = username
    setHasFetchedDecks(false)
    clearDecks()
    return () => {
      clearDecks()
    }
  }, [username, clearDecks])

  // Progress timers (re-use logic from search page)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    if (progress.status === 'running' && progress.startedAt) {
      const tick = () => {
        setElapsedMs(Date.now() - (progress.startedAt || Date.now()))
      }
      tick()
      timer = setInterval(tick, 400)
    } else if (progress.startedAt && progress.finishedAt) {
      setTimeout(() => setElapsedMs((progress.finishedAt || 0) - (progress.startedAt || 0)), 0)
    } else {
      setTimeout(() => setElapsedMs(0), 0)
    }

    return () => {
      if (timer) clearInterval(timer)
    }
  }, [progress.finishedAt, progress.startedAt, progress.status])

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const status = progress.status
    if (status === 'running' || status === 'error') {
      showTimer = setTimeout(() => setProgressVisible(true), 0)
    } else if (status === 'done' || status === 'cached') {
      showTimer = setTimeout(() => setProgressVisible(true), 0)
      hideTimer = setTimeout(() => setProgressVisible(false), 2000)
    } else if (status === 'idle') {
      hideTimer = setTimeout(() => setProgressVisible(false), 0)
    }
    return () => {
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [progress.status])

  const handleLoadDecks = async () => {
    if (!username || decksLoading) return
    const requestUsername = username
    setDeckSectionCollapsed(false)
    setHasFetchedDecks(false)
    clearDecks()
    try {
      await fetchDecks(username, { force: forceRefresh })
    } catch (err) {
      console.error('[PlayerProfile] Failed to load decks:', err)
    } finally {
      if (isMountedRef.current && activeUsernameRef.current === requestUsername) {
        setHasFetchedDecks(true)
      }
    }
  }

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
    return `${seconds}s`
  }

  const totalSteps = progress.totalSteps || progress.steps.length || 1
  const completedSteps = progress.steps.filter((s) => s.status === 'done').length
  const progressValue = Math.min(100, Math.round((completedSteps / totalSteps) * 100))
  const stepForMessage =
    progress.steps.find((s) => s.status !== 'done') ||
    progress.steps.find((s) => s.status === 'pending') ||
    progress.steps[progress.steps.length - 1]
  const trimmedProgressMessage = progress.message?.trim()
  const progressMessageIsTag = !!trimmedProgressMessage && trimmedProgressMessage.toLowerCase().includes('tag')
  const activeLabel =
    (!progressMessageIsTag && trimmedProgressMessage) || stepForMessage?.label || 'Working...'

  const factionStats = useMemo(() => (profile ? getFactionAmounts(profile) : []), [profile])
  const rarityStats = useMemo(() => (profile ? getRarityBands(profile) : []), [profile])
  const totalPoints = useMemo(() => (profile ? getTotalPoints(profile) : 0), [profile])
  const achievementEntries = useMemo(() => (profile ? flattenAchievements(profile) : []), [profile])
  const hasDeckResults = useMemo(
    () => (decks?.length ?? 0) > 0 || (fusedDecks?.length ?? 0) > 0,
    [decks, fusedDecks]
  )

  const keyValueBadges = (obj?: Record<string, number | string | null | undefined>) => {
    if (!obj || Object.keys(obj).length === 0) {
      return (
        <Text className="text-gray-400" size="sm">
          No data.
        </Text>
      )
    }
    return (
      <Group gap="xs" wrap="wrap">
        {Object.entries(obj).map(([k, v]) => (
          <Badge key={k} color="gray" variant="light">
            {k}: {v ?? '—'}
          </Badge>
        ))}
      </Group>
    )
  }

  const displayName =
    playerProfileMeta?.display_name ||
    profile?.displayName ||
    profile?.username ||
    username
  const usernameLabel = profile?.username || playerProfileMeta?.player_name || username
  const discordLabel = playerProfileMeta?.discord_name || null

  return (
    <main className="min-h-screen relative overflow-hidden">
      <BackgroundElements />
      <Header />
      <Container size="xl" className="relative z-10 py-12">
        <div className="w-full max-w-6xl mx-auto">
          <Stack gap="xl">
            <Group justify="space-between">
              <div>
                <Title order={2} className="text-white">
                  Player Profile
                </Title>
                <Text className="text-gray-400">
                  Live snapshot pulled from SolForge Fusion API for <strong>{displayName}</strong>
                </Text>
              </div>
              <Group gap="sm">
                <Button
                  variant="light"
                  leftSection={<IconArrowLeft size={16} />}
                  component="a"
                  href="/"
                >
                  Back to search
                </Button>
                <Button
                  variant="subtle"
                  leftSection={<IconWorld size={16} />}
                  component="a"
                  href={`https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/user/${encodeURIComponent(username)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open API
                </Button>
              </Group>
            </Group>

            {loading && (
              <Group justify="center" py="xl">
                <Loader size="lg" />
              </Group>
            )}

            {error && !loading && (
              <Paper p="md" className="bg-slate-800/70 border border-red-500/40 rounded-lg">
                <Text className="text-red-300">Failed to load profile: {error}</Text>
              </Paper>
            )}

            {profile && !loading && (
              <Stack gap="lg">
                <Paper
                  p="lg"
                  className="bg-gradient-to-r from-sf-primary/80 to-sf-secondary/60 border border-sf-primary/40 rounded-xl shadow-xl"
                >
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={6}>
                      <Group gap="sm" wrap="wrap">
                        <Title order={2} className="text-white" style={{ marginBottom: 0 }}>
                          {displayName} ({usernameLabel})
                        </Title>
                        {discordLabel && (
                          <Badge
                            color="violet"
                            variant="filled"
                            leftSection={<IconBrandDiscord size={14} />}
                            styles={{ root: { backgroundColor: '#6b5bff' } }}
                          >
                            {discordLabel}
                          </Badge>
                        )}
                        {profile.isActive ? (
                          <Badge color="green" leftSection={<IconCheck size={14} />}>
                            Active
                          </Badge>
                        ) : (
                          <Badge color="gray" leftSection={<IconCircleDashed size={14} />}>
                            Inactive
                          </Badge>
                        )}
                      </Group>
                      <Text className="text-gray-200" size="sm">
                        Elo and progression overview for this player.
                      </Text>
                      <Group gap="sm">
                        <Badge color="violet" variant="filled">
                          ELO: {formatNumber(profile.elo)}
                        </Badge>
                        <Badge color="blue" variant="filled">
                          XP: {formatNumber(profile.xp)}
                        </Badge>
                        <Badge color="yellow" variant="light">
                          Gold: {formatNumber(profile.gold)}
                        </Badge>
                        <Badge color="orange" variant="light">
                          Embers: {formatNumber(profile.embers)}
                        </Badge>
                        <Badge color="grape" leftSection={<IconTrophy size={14} />}>
                          Points: {formatNumber(totalPoints)}
                        </Badge>
                      </Group>
                    </Stack>
                    <Stack gap={6} align="flex-end">
                      <Text className="text-white" fw={700}>
                        Earned rewards
                      </Text>
                      <Text className="text-gray-200" size="sm">
                        {profile.earnedRewards?.length ?? 0} unlocked
                      </Text>
                    </Stack>
                  </Group>
                </Paper>

              <Paper
                p="lg"
                className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
              >
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <div>
                      <Title order={4} className="text-white" style={{ marginBottom: 0 }}>
                        Decks
                      </Title>
                    </div>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      loading={decksLoading}
                      onClick={handleLoadDecks}
                    >
                        Load player decks
                    </Button>
                    <Checkbox
                      size="sm"
                      checked={forceRefresh}
                      onChange={(event) => setForceRefresh(event.currentTarget.checked)}
                      label={
                        <Text size="sm" className="text-gray-200">
                          Force refresh (ignore 24h cache)
                        </Text>
                      }
                    />
                    <ActionIcon
                      variant="light"
                      color="gray"
                      size="lg"
                      onClick={() => setDeckSectionCollapsed((prev) => !prev)}
                      aria-label={deckSectionCollapsed ? 'Expand decks section' : 'Collapse decks section'}
                    >
                      {deckSectionCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
                    </ActionIcon>
                  </Group>
                </Group>

                {!deckSectionCollapsed && (
                  <>
                    {progressVisible && (
                      <Paper p="md" className="bg-slate-800/70 border border-sf-primary/30 rounded-lg">
                        <Stack gap="xs">
                          <Group justify="space-between" align="center">
                            <Stack gap={2}>
                              <Text fw={600} className="text-white">
                                Searching decks for {username}
                              </Text>
                              <Text size="sm" className="text-gray-300">
                                {activeLabel}
                              </Text>
                            </Stack>
                            <Badge color="blue" variant="light">
                              Step {progress.currentStepIndex + 1} / {totalSteps}
                            </Badge>
                          </Group>
                          <Progress value={progressValue} striped animated />
                          <Group gap="lg">
                            <div>
                              <Text size="sm" className="text-gray-400">
                                Elapsed
                              </Text>
                              <Text fw={600} className="text-white">
                                {formatDuration(elapsedMs)}
                              </Text>
                            </div>
                            <div>
                              <Text size="sm" className="text-gray-400">
                                ETA
                              </Text>
                              <Text fw={600} className="text-white">
                                {progress.status === 'done' || progress.status === 'cached'
                                  ? '—'
                                  : 'Estimating...'}
                              </Text>
                            </div>
                          </Group>
                          <Stack gap={4}>
                            {progress.steps.map((step) => {
                              const state = step.status
                              const duration =
                                step.startedAt && step.finishedAt
                                  ? formatDuration(step.finishedAt - step.startedAt)
                                  : state === 'active'
                                    ? formatDuration(Date.now() - (step.startedAt || progress.startedAt || Date.now()))
                                    : '0s'
                              return (
                                <Group
                                  key={step.key}
                                  justify="space-between"
                                  className="bg-slate-900/60 border border-sf-primary/20 rounded px-2 py-1"
                                >
                                  <Group gap="xs">
                                    {state === 'done' ? (
                                      <IconCheck size={16} color="#22c55e" />
                                    ) : state === 'active' ? (
                                      <Loader size="xs" />
                                    ) : (
                                      <IconCircleDashed size={16} color="#94a3b8" />
                                    )}
                                    <Text className="text-white" size="sm">
                                      {step.label}
                                    </Text>
                                  </Group>
                                  <Group gap="xs">
                                    <Badge color="gray" variant="light">
                                      {duration}
                                    </Badge>
                                    <Badge
                                      color={
                                        state === 'done'
                                          ? 'teal'
                                          : state === 'active'
                                            ? 'blue'
                                            : 'gray'
                                      }
                                      variant="light"
                                    >
                                      {state === 'done'
                                        ? 'done'
                                        : state === 'active'
                                          ? 'in progress'
                                          : 'waiting'}
                                    </Badge>
                                  </Group>
                                </Group>
                              )
                            })}
                          </Stack>
                        </Stack>
                      </Paper>
                    )}
                    {decksError && (
                      <Paper p="md" className="bg-slate-800/70 border border-red-500/40 rounded-lg">
                        <Text className="text-red-300">
                          Failed to load decks: {decksError}
                        </Text>
                        </Paper>
                      )}
                      {decksLoading && (
                        <Group justify="center" py="md">
                          <Loader />
                        </Group>
                      )}
                      {!decksLoading && hasDeckResults && (
                        <div className="flex justify-center">
                          <DeckList decks={decks} fusedDecks={fusedDecks} />
                        </div>
                      )}
                      {!decksLoading && !hasDeckResults && hasFetchedDecks && !decksError && (
                        <Paper p="md" className="bg-slate-800/70 border border-sf-primary/30 rounded-lg">
                          <Text className="text-gray-300">No decks found for this player yet.</Text>
                        </Paper>
                      )}
                    </>
                  )}
                </Stack>
              </Paper>

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
                {factionStats.map((faction) => (
                  <Paper
                    key={faction.faction}
                    p="md"
                    className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
                  >
                    <Stack gap={4}>
                      <Group justify="space-between">
                        <Text fw={600} className="text-white capitalize">
                          {faction.faction}
                        </Text>
                        <Badge color="blue" variant="light">
                          Decks
                        </Badge>
                      </Group>
                      <Title order={3} className="text-white">
                        {formatNumber(faction.amount)}
                      </Title>
                    </Stack>
                  </Paper>
                ))}
              </SimpleGrid>

              <Paper
                p="lg"
                className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
              >
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Title order={4} className="text-white">
                      Rarity spread
                    </Title>
                    <Text size="sm" className="text-gray-400">
                      Progress toward 25 decks per rarity band
                    </Text>
                  </Group>
                  <Stack gap="sm">
                    {rarityStats.map((band) => {
                      const percent = Math.min(100, Math.round((band.amount / band.goal25) * 100))
                      return (
                        <div key={band.key}>
                          <Group justify="space-between" align="center">
                            <Text className="text-gray-200" fw={600}>
                              {band.label}
                            </Text>
                            <Text size="sm" className="text-gray-300">
                              {formatNumber(band.amount)} / {band.goal25}
                            </Text>
                          </Group>
                          <Progress value={percent} color="violet" size="md" />
                        </div>
                      )
                    })}
                  </Stack>
                </Stack>
              </Paper>

              <Paper
                p="lg"
                className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
              >
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Title order={4} className="text-white">
                      Active quests
                    </Title>
                    <Text className="text-gray-400" size="sm">
                      Track current progress
                    </Text>
                  </Group>
                  <QuestList quests={profile.quests} />
                </Stack>
              </Paper>

              <Paper
                p="lg"
                className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
              >
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <Title order={4} className="text-white">
                      Earned rewards (recent)
                    </Title>
                    <Text className="text-gray-400" size="sm">
                      Showing first 20 entries
                    </Text>
                  </Group>
                  <Divider opacity={0.3} />
                  <Group gap="xs" wrap="wrap">
                    {(profile.earnedRewards ?? []).slice(0, 20).map((reward) => (
                      <Badge key={reward} color="indigo" variant="light">
                        {reward}
                      </Badge>
                    ))}
                    {(profile.earnedRewards?.length ?? 0) === 0 && (
                      <Text className="text-gray-400" size="sm">
                        No rewards yet.
                      </Text>
                    )}
                  </Group>
                  {profile.earnedRewards && profile.earnedRewards.length > 20 && (
                    <Text size="sm" className="text-gray-400">
                      +{profile.earnedRewards.length - 20} more
                    </Text>
                  )}
                </Stack>
              </Paper>

              <Paper
                p="lg"
                className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
              >
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Title order={4} className="text-white">
                      Stats & Metadata
                    </Title>
                    <Text className="text-gray-400" size="sm">
                      Live snapshot fields
                    </Text>
                  </Group>
                  <Group gap="sm" wrap="wrap">
                    {profile.playId && (
                      <Badge color="blue" variant="light">
                        Play ID: {profile.playId}
                      </Badge>
                    )}
                    {profile.referralCode && (
                      <Badge color="indigo" variant="light">
                        Referral: {profile.referralCode}
                      </Badge>
                    )}
                    {profile.version && (
                      <Badge color="gray" variant="light">
                        Version: {profile.version}
                      </Badge>
                    )}
                  </Group>
                  <Group gap="sm" wrap="wrap">
                    <Badge color="teal" variant="light">
                      Tutorial: {formatNumber(profile.tutorialStatus)}
                    </Badge>
                    <Badge color="teal" variant="light">
                      Campaign unlock: {formatNumber(profile.campaignUnlockLevel)}
                    </Badge>
                    <Badge color="teal" variant="light">
                      Ascension: {formatNumber(profile.ascensionReclusa)}
                    </Badge>
                    <Badge color="teal" variant="light">
                      Free decks: {formatNumber(profile.freeDecksAwarded)}
                    </Badge>
                    <Badge color="teal" variant="light">
                      XP MT002: {formatNumber(profile.xp_mt002)}
                    </Badge>
                  </Group>
                  <Divider opacity={0.3} />
                  <Stack gap="sm">
                    <Text className="text-white" fw={600}>
                      Consumables
                    </Text>
                    {keyValueBadges(profile.consumables)}
                  </Stack>
                  <Stack gap="sm">
                    <Text className="text-white" fw={600}>
                      Purchases
                    </Text>
                    {keyValueBadges(profile.purchases)}
                  </Stack>
                  <Stack gap="sm">
                    <Text className="text-white" fw={600}>
                      Wallet & Web3
                    </Text>
                    <Group gap="sm" wrap="wrap">
                      <Badge color="gray" variant="light">
                        Reward address: {profile.rewardAddress || '—'}
                      </Badge>
                      <Badge color={profile.botProtection ? 'green' : 'gray'} variant="light">
                        Bot protection: {profile.botProtection ? 'On' : 'Off'}
                      </Badge>
                    </Group>
                    <Stack gap={4}>
                      <Text className="text-gray-300" size="sm">
                        Cosmetics
                      </Text>
                      {profile.cosmetics && profile.cosmetics.length > 0 ? (
                        <Group gap="xs" wrap="wrap">
                          {profile.cosmetics.map((cos) => (
                            <Badge key={cos} color="violet" variant="light">
                              {cos}
                            </Badge>
                          ))}
                        </Group>
                      ) : (
                        <Text className="text-gray-400" size="sm">
                          No cosmetics.
                        </Text>
                      )}
                    </Stack>
                    <Stack gap={4}>
                      <Text className="text-gray-300" size="sm">
                        Extra XP
                      </Text>
                      <Group gap="xs" wrap="wrap">
                        <Badge color="indigo" variant="light">
                          XP MT002: {formatNumber(profile.xp_mt002)}
                        </Badge>
                        <Badge color="indigo" variant="light">
                          XP MT Test: {formatNumber(profile.xp_mt_test)}
                        </Badge>
                      </Group>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>

              <Paper
                p="lg"
                className="bg-slate-800/70 border border-sf-primary/30 rounded-lg"
              >
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Title order={4} className="text-white">
                      Achievements (Season 1)
                    </Title>
                    <Text className="text-gray-400" size="sm">
                      Collection, Rarity, Community, Play, Web3, Purchase
                    </Text>
                  </Group>
                  {achievementEntries.length === 0 ? (
                    <Text className="text-gray-400" size="sm">
                      No achievements data.
                    </Text>
                  ) : (
                    <Accordion variant="separated" radius="md">
                      {achievementEntries.map((entry, idx) => {
                        const data = entry.data as any
                        const points = data?.points ?? data?.basePoints ?? null
                        const amount = data?.amount ?? null
                        const achieved = data?.achieved === true
                        const details = Object.entries(data).filter(
                          ([key]) => !['points', 'basePoints', 'amount', 'achieved'].includes(key)
                        )
                        const renderObjectBadges = (val: Record<string, any>, prefix = ''): React.ReactNode[] => {
                          const badges: React.ReactNode[] = []
                          Object.entries(val).forEach(([k, v]) => {
                            const key = prefix ? `${prefix}.${k}` : k
                            if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                              badges.push(...renderObjectBadges(v as Record<string, any>, key))
                            } else {
                              badges.push(
                                <Badge key={key} color="gray" variant="light" size="xs">
                                  {key}: {v ?? '—'}
                                </Badge>
                              )
                            }
                          })
                          return badges
                        }
                        const renderValue = (val: any) => {
                          if (typeof val === 'boolean') return val ? 'Yes' : 'No'
                          if (val === null || val === undefined) return '—'
                          if (typeof val === 'number' || typeof val === 'string') return String(val)
                          if (typeof val === 'object') {
                            const badges: React.ReactNode[] = []
                            if ('achieved' in val) {
                              badges.push(
                                <Badge key="ach" color={val.achieved ? 'green' : 'gray'} variant="light" size="xs">
                                  {val.achieved ? 'Achieved' : 'Not yet'}
                                </Badge>
                              )
                            }
                            if ('amount' in val) {
                              badges.push(
                                <Badge key="amt" color="blue" variant="light" size="xs">
                                  Amount: {formatNumber(val.amount)}
                                </Badge>
                              )
                            }
                            if ('points' in val || 'basePoints' in val) {
                              const pts = val.points ?? val.basePoints
                              badges.push(
                                <Badge key="pts" color="grape" variant="light" size="xs">
                                  {pts} pts
                                </Badge>
                              )
                            }
                            const extraBadges = renderObjectBadges(
                              Object.fromEntries(
                                Object.entries(val).filter(
                                  ([k]) => !['achieved', 'amount', 'points', 'basePoints'].includes(k)
                                )
                              )
                            )
                            if (badges.length === 0 && extraBadges.length === 0) {
                              return '—'
                            }
                            return (
                              <Group gap="xs" wrap="wrap">
                                {badges}
                                {extraBadges}
                              </Group>
                            )
                          }
                          return String(val)
                        }
                        return (
                          <Accordion.Item key={`${entry.category}-${entry.label}-${idx}`} value={`${entry.category}-${entry.label}-${idx}`}>
                            <Accordion.Control>
                              <Group justify="space-between" wrap="nowrap">
                                <Group gap="xs" wrap="nowrap">
                                  <Badge color="blue" variant="light" size="sm">
                                    {entry.category}
                                  </Badge>
                                  <Text className="text-white">{entry.label}</Text>
                                </Group>
                                <Group gap="xs" wrap="nowrap">
                                  {points !== null && (
                                    <Badge color="grape" variant="light" size="sm">
                                      {points} pts
                                    </Badge>
                                  )}
                                  {amount !== null && (
                                    <Badge color="blue" variant="light" size="sm">
                                      {amount}
                                    </Badge>
                                  )}
                                  {achieved && (
                                    <Badge
                                      color="green"
                                      leftSection={<IconCheck size={12} />}
                                      variant="light"
                                      size="sm"
                                    >
                                      Achieved
                                    </Badge>
                                  )}
                                </Group>
                              </Group>
                            </Accordion.Control>
                            <Accordion.Panel>
                              <Stack gap={4}>
                                {details.length === 0 ? (
                                  <Text className="text-gray-400" size="sm">
                                    No extra details.
                                  </Text>
                                ) : (
                                  details.map(([key, val]) => {
                                    const rendered = renderValue(val)
                                    const isString = typeof rendered === 'string'
                                    return (
                                      <Group key={key} justify="space-between" align="flex-start">
                                        <Text className="text-gray-300" size="sm">
                                          {key}
                                        </Text>
                                        {isString ? (
                                          <Text className="text-gray-100" size="sm">
                                            {rendered}
                                          </Text>
                                        ) : (
                                          rendered
                                        )}
                                      </Group>
                                    )
                                  })
                                )}
                              </Stack>
                            </Accordion.Panel>
                          </Accordion.Item>
                        )
                      })}
                    </Accordion>
                  )}
                </Stack>
              </Paper>
            </Stack>
          )}
        </Stack>
        </div>
      </Container>
    </main>
  )
}
